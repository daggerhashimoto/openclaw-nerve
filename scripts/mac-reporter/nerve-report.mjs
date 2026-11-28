#!/usr/bin/env node
/**
 * nerve-report — push-only work reporter for a Mac (or any machine).
 *
 * It sends small structured reports to a Nerve server: repository/branch/commit
 * state, plus the session's own summary and whatever the reporter verified.
 * It never sends prompts, transcript bodies, diffs or environment secrets.
 *
 * Commands:
 *   init       write the config (server, token, workstreams)
 *   report     send a report for the current repo
 *   hook       read a Claude Code hook payload from stdin and report it
 *   flush      retry queued reports
 *   ping       check the server accepts the token
 *   digest     print a markdown summary from the server (for the PM brief)
 *   status     show config, queue depth and last error
 *
 * No dependencies. Node 18 or newer.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERSION = '1.0.0';
const HOME = os.homedir();
const ROOT = process.env.NERVE_REPORTER_HOME || path.join(HOME, '.nerve', 'reporter');
const CONFIG_PATH = process.env.NERVE_REPORTER_CONFIG || path.join(ROOT, 'config.json');
const QUEUE_DIR = path.join(ROOT, 'queue');
const LOG_PATH = path.join(ROOT, 'logs', 'reporter.log');
const MAX_SUMMARY = 600;

const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function fail(message, code = 1) {
  console.error(`nerve-report: ${message}`);
  process.exit(code);
}

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true, mode: 0o700 });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    /* logging must never break reporting */
  }
}

function redact(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
  return text.replace(/\s+/g, ' ').trim();
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    fail(`no config at ${CONFIG_PATH}. Run the installer, or: nerve-report init --server <url> --token <token>`);
    throw error;
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function findRepo(start) {
  const top = git(start, ['rev-parse', '--show-toplevel']);
  if (!top) return null;

  const branch = git(top, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '(detached)';
  const commit = git(top, ['rev-parse', 'HEAD']) ?? '';
  const subject = git(top, ['log', '-1', '--format=%s']) ?? '';
  const porcelain = git(top, ['status', '--porcelain']) ?? '';
  const changedFiles = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
  const remote = git(top, ['remote', 'get-url', 'origin']) ?? undefined;
  const upstream = git(top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) ?? undefined;

  let ahead;
  let behind;
  if (upstream) {
    const counts = git(top, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    if (counts) {
      const [behindRaw, aheadRaw] = counts.split(/\s+/);
      behind = Number(behindRaw);
      ahead = Number(aheadRaw);
    }
  }

  return {
    path: top,
    remote,
    branch,
    commit,
    commitSubject: subject || undefined,
    dirty: changedFiles > 0,
    changedFiles,
    ahead,
    behind,
    upstream,
  };
}

function workstreamFor(config, repoPath) {
  let best = null;
  for (const entry of config.workstreams ?? []) {
    if (!entry?.path) continue;
    const base = path.resolve(entry.path.replace(/^~(?=$|\/)/, HOME));
    if ((repoPath === base || repoPath.startsWith(`${base}${path.sep}`)) && (!best || base.length > best.base.length)) {
      best = { name: entry.name, base };
    }
  }
  return best?.name ?? path.basename(repoPath);
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Last assistant text in a Claude Code transcript, without reading user prompts. */
function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }

  let last = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'assistant') continue;
    const content = entry.message?.content;
    if (typeof content === 'string') {
      last = content;
      continue;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      if (text.trim()) last = text;
    }
  }
  return redact(last).slice(0, MAX_SUMMARY);
}

function queueReport(report) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(QUEUE_DIR, `${report.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report)}\n`, { mode: 0o600 });
  return file;
}

async function send(config, report) {
  const timeout = Number(config.timeoutMs) || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${String(config.server).replace(/\/$/, '')}/api/work/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function describeSendFailure(status) {
  if (status === 401) return 'the server rejected the token (401)';
  if (status === 503) return 'the server has no reporter token configured (503)';
  if (status === 400) return 'the server rejected the report shape (400)';
  return `server returned ${status}`;
}

/**
 * Send, or queue when the network or the server is unavailable. A config
 * problem (401/503/400) is reported and exits 2: retrying cannot fix it.
 */
async function deliver(config, report, { quiet = false } = {}) {
  try {
    const result = await send(config, report);
    if (result.status >= 200 && result.status < 300) {
      if (!quiet) console.log(`nerve-report: sent ${report.id}`);
      return true;
    }
    if (result.status === 400 || result.status === 401 || result.status === 503) {
      log(`rejected ${report.id}: ${result.body}`);
      fail(describeSendFailure(result.status), 2);
    }
    queueReport(report);
    log(`queued ${report.id}: ${describeSendFailure(result.status)}`);
    if (!quiet) console.error(`nerve-report: queued (${describeSendFailure(result.status)})`);
    return false;
  } catch (error) {
    queueReport(report);
    const reason = error?.name === 'AbortError' ? 'timed out' : 'server unreachable';
    log(`queued ${report.id}: ${reason}`);
    if (!quiet) console.error(`nerve-report: queued (${reason})`);
    return false;
  }
}

async function flushQueue(config) {
  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return { sent: 0, remaining: 0 };
  }

  let sent = 0;
  for (const name of files) {
    const file = path.join(QUEUE_DIR, name);
    let report;
    try {
      report = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      fs.renameSync(file, `${file}.bad`);
      continue;
    }
    try {
      const result = await send(config, report);
      if (result.status >= 200 && result.status < 300) {
        fs.unlinkSync(file);
        sent += 1;
        continue;
      }
      if (result.status === 400 || result.status === 401 || result.status === 503) {
        log(`flush stopped: ${describeSendFailure(result.status)}`);
        break;
      }
    } catch {
      break;
    }
  }

  let remaining = 0;
  try {
    remaining = fs.readdirSync(QUEUE_DIR).filter((name) => name.endsWith('.json')).length;
  } catch {
    /* no queue */
  }
  return { sent, remaining };
}

function buildReport(config, options) {
  const repo = options.repoPath ? findRepo(options.repoPath) : null;
  const workstream = options.workstream
    ?? (repo ? workstreamFor(config, repo.path) : path.basename(options.repoPath || process.cwd()));

  const observed = [];
  if (repo) {
    observed.push({ kind: 'commit', text: `${repo.commit.slice(0, 7)} ${repo.commitSubject ?? ''}`.trim(), ok: true });
  }
  for (const item of options.observed ?? []) observed.push(item);

  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    workstream,
    agent: {
      kind: options.agentKind,
      sessionId: options.sessionId,
      model: options.model,
    },
    repo: repo ?? undefined,
    outcome: {
      summary: options.summary ? redact(options.summary).slice(0, MAX_SUMMARY) : undefined,
      claims: (options.claims ?? []).map((claim) => redact(claim).slice(0, 300)),
      status: options.status,
    },
    observed,
    links: options.links,
    meta: {
      hostname: os.hostname(),
      reporterVersion: VERSION,
      queuedAt: new Date().toISOString(),
    },
  };
}

function parseArgv(argv) {
  const flags = { observed: [], workstreams: [], claims: [], roots: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=', 2);
    const next = inline ?? argv[i + 1];
    const take = () => {
      if (inline === undefined) i += 1;
      return next;
    };
    switch (key) {
      case 'server': flags.server = take(); break;
      case 'token': flags.token = take(); break;
      case 'workstream': flags.workstreams.push(take()); break;
      case 'repo': flags.repo = take(); break;
      case 'summary': flags.summary = take(); break;
      case 'summary-file': flags.summaryFile = take(); break;
      case 'status': flags.status = take(); break;
      case 'agent': flags.agent = take(); break;
      case 'session-id': flags.sessionId = take(); break;
      case 'model': flags.model = take(); break;
      case 'pr': flags.pr = take(); break;
      case 'claim': flags.claims.push(take()); break;
      case 'observed': flags.observed.push(take()); break;
      case 'since': flags.since = take(); break;
      case 'root': flags.roots.push(take()); break;
      case 'json': flags.json = true; break;
      case 'markdown': flags.markdown = true; break;
      case 'quiet': flags.quiet = true; break;
      case 'dry-run': flags.dryRun = true; break;
      case 'no-hooks': flags.noHooks = true; break;
      default: fail(`unknown flag --${key}`);
    }
  }
  return { flags, positional };
}

/** `test|ok|npm test — 3337 passed` or `commit|npm run build` (ok defaults to true). */
function parseObserved(raw) {
  const [kind, second, ...rest] = String(raw).split('|');
  const allowed = ['test', 'build', 'lint', 'commit', 'push', 'pr', 'merge', 'other'];
  if (!allowed.includes(kind)) fail(`--observed kind must be one of ${allowed.join(', ')}`);
  const isBool = second === 'ok' || second === 'fail';
  return {
    kind,
    ok: isBool ? second === 'ok' : true,
    text: redact((isBool ? rest.join('|') : [second, ...rest].join('|')) || kind).slice(0, 300) || kind,
  };
}

function cmdInit(flags) {
  if (!flags.server) fail('init needs --server');
  if (!flags.token) fail('init needs --token');
  if (!/^https?:\/\//.test(flags.server)) fail('--server must start with http:// or https://');

  const config = {
    version: 1,
    server: flags.server.replace(/\/$/, ''),
    token: flags.token,
    workstreams: flags.workstreams.map((entry) => {
      const [name, repoPath] = entry.split('=');
      if (!name || !repoPath) fail(`--workstream must be name=path, got ${entry}`);
      return { name, path: repoPath };
    }),
    timeoutMs: 8000,
  };
  saveConfig(config);
  fs.mkdirSync(QUEUE_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true, mode: 0o700 });
  console.log(`nerve-report: configured ${CONFIG_PATH}`);
  return 0;
}

async function cmdPing(flags) {
  const config = loadConfig();
  if (flags.server) config.server = flags.server;
  if (flags.token) config.token = flags.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 8000);
  try {
    const response = await fetch(`${config.server.replace(/\/$/, '')}/api/work/ping`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });
    const body = await response.text();
    console.log(`nerve-report: ping ${response.status} ${body.trim()}`);
    return response.ok ? 0 : 2;
  } catch (error) {
    console.error(`nerve-report: ping failed (${error?.name === 'AbortError' ? 'timed out' : 'unreachable'})`);
    return 2;
  } finally {
    clearTimeout(timer);
  }
}

async function cmdReport(flags) {
  const config = loadConfig();
  let summary = flags.summary ?? '';
  if (flags.summaryFile) {
    summary = flags.summaryFile === '-' ? readStdin() : fs.readFileSync(flags.summaryFile, 'utf8');
  }

  const report = buildReport(config, {
    repoPath: flags.repo || process.cwd(),
    workstream: flags.workstreams[0],
    summary,
    status: flags.status || 'completed',
    agentKind: flags.agent || 'manual',
    sessionId: flags.sessionId,
    model: flags.model,
    claims: flags.claims,
    observed: (flags.observed ?? []).map(parseObserved),
    links: flags.pr ? { pr: flags.pr } : undefined,
  });

  if (flags.dryRun) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  await flushQueue(config);
  await deliver(config, report, { quiet: flags.quiet });
  return 0;
}

async function cmdHook(flags, positional) {
  const hookName = positional[1] || 'claude';
  const payload = readStdin();
  let input = {};
  if (payload.trim()) {
    try {
      input = JSON.parse(payload);
    } catch {
      input = {};
    }
  }

  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const summary = lastAssistantText(input.transcript_path)
    || `Session ended${input.reason ? ` (${input.reason})` : ''}`;

  const config = loadConfig();
  const report = buildReport(config, {
    repoPath: cwd,
    summary,
    status: 'completed',
    agentKind: hookName === 'claude' ? 'claude-code' : hookName,
    sessionId: input.session_id,
    model: input.model,
    claims: [],
    observed: [],
  });

  await flushQueue(config);
  await deliver(config, report);
  return 0;
}

async function cmdFlush(flags) {
  const config = loadConfig();
  const result = await flushQueue(config);
  console.log(`nerve-report: flushed ${result.sent}, ${result.remaining} still queued`);
  return 0;
}

function formatSince(value) {
  if (!value) return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (/^\d+[mhd]$/.test(value)) {
    const unit = value.slice(-1);
    const amount = Number(value.slice(0, -1));
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - amount * ms).toISOString();
  }
  return value;
}

async function cmdDigest(flags) {
  const config = loadConfig();
  const since = formatSince(flags.since);
  const params = new URLSearchParams({ since });
  if (flags.workstreams[0]) params.set('workstream', flags.workstreams[0]);

  const response = await fetch(`${config.server.replace(/\/$/, '')}/api/work/reports/summary?${params}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) fail(`digest failed: ${response.status}`, 2);
  const summary = await response.json();

  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  const lines = [];
  lines.push(`### Work reported by other machines (since ${since})`);
  if (summary.counts.reports === 0) {
    lines.push('');
    lines.push('No reports in this window.');
    return console.log(lines.join('\n')), 0;
  }
  lines.push('');
  lines.push(`${summary.counts.reports} report(s) · ${Object.keys(summary.counts.byWorkstream).length} workstream(s) · ${summary.counts.dirtyRepos} with uncommitted work`);
  const o = summary.observed;
  if (o.tests + o.builds + o.commits + o.pushes > 0) {
    lines.push(`Observed: ${o.tests} test run(s) (${o.passed} passed, ${o.failed} failed), ${o.builds} build(s), ${o.commits} commit(s), ${o.pushes} push(es)`);
  }
  for (const report of summary.reports.slice(0, 15)) {
    const when = new Date(report.at).toISOString().replace('T', ' ').slice(0, 16);
    const repo = report.repo ? `${path.basename(report.repo.path)}@${report.repo.branch} ${report.repo.commit.slice(0, 7)}${report.repo.dirty ? ' (dirty)' : ''}` : 'no repo';
    const said = report.outcome?.summary ? ` — ${report.outcome.summary}` : '';
    lines.push(`- ${when} · ${report.workstream} · ${repo} · ${report.outcome?.status ?? 'unknown'}${said}`);
  }
  lines.push('');
  lines.push('_Summaries are agent-reported; commits, dirty state and test counts above are reporter-observed._');
  console.log(lines.join('\n'));
  return 0;
}

function cmdStatus(flags) {
  let config = null;
  try {
    config = loadConfig();
  } catch {
    /* reported below */
  }
  let queued = 0;
  try {
    queued = fs.readdirSync(QUEUE_DIR).filter((name) => name.endsWith('.json')).length;
  } catch {
    /* no queue */
  }

  const status = {
    version: VERSION,
    configPath: CONFIG_PATH,
    configured: Boolean(config),
    server: config?.server ?? null,
    workstreams: config?.workstreams ?? [],
    queued,
  };
  console.log(flags.json ? JSON.stringify(status, null, 2) : [
    `nerve-report ${VERSION}`,
    `config: ${CONFIG_PATH}${config ? '' : ' (missing)'}`,
    `server: ${status.server ?? '-'}`,
    `workstreams: ${status.workstreams.map((w) => `${w.name}=${w.path}`).join(', ') || '-'}`,
    `queued: ${queued}`,
  ].join('\n'));
  return config ? 0 : 2;
}

const { flags, positional } = parseArgv(process.argv.slice(2));
const command = positional[0] || 'status';

const commands = {
  init: () => cmdInit(flags),
  report: () => cmdReport(flags),
  hook: () => cmdHook(flags, positional),
  flush: () => cmdFlush(flags),
  ping: () => cmdPing(flags),
  digest: () => cmdDigest(flags),
  status: () => cmdStatus(flags),
  version: () => console.log(VERSION),
};

if (!commands[command]) fail(`unknown command ${command}. Try: ${Object.keys(commands).join(', ')}`);
const code = await commands[command]();
process.exitCode = code ?? 0;
