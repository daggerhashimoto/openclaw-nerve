/** Tests for the skills API route (GET /api/skills). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface ExecError extends Error {
  code?: string;
  killed?: boolean;
  signal?: string;
}

type ExecCb = (err: ExecError | null, stdout: string, stderr: string) => void;

type ExecCall = {
  bin: string;
  args: string[];
  opts: Record<string, unknown> | undefined;
};

let execFileImpl: (bin: string, args: string[], opts: unknown, cb: ExecCb) => void;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = {
    ...actual,
    execFile: (...args: unknown[]) => {
      const [bin, cmdArgs, opts, cb] = args as [string, string[], unknown, ExecCb];
      return execFileImpl(bin, cmdArgs, opts, cb);
    },
  };
  return { ...mock, default: mock };
});

vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('../lib/openclaw-bin.js', () => ({
  resolveOpenclawBin: () => '/usr/bin/openclaw',
}));

const RAW_SKILLS = [
  { name: 'weather', description: 'Get weather', emoji: '🌤️', eligible: true, disabled: false, blockedByAllowlist: false, source: 'bundled', bundled: true },
  { name: 'github', description: 'GitHub ops', emoji: '🐙', eligible: true, disabled: false, blockedByAllowlist: false, source: 'bundled', bundled: true },
];

const GOOD_SKILLS_JSON = JSON.stringify({ skills: RAW_SKILLS });
const GOOD_SKILLS_ARRAY_JSON = JSON.stringify(RAW_SKILLS);

function findExecCall(calls: ExecCall[], args: string[]): ExecCall | undefined {
  return calls.find((call) => call.args.length === args.length && call.args.every((value, index) => value === args[index]));
}

describe('GET /api/skills', () => {
  let homeDir: string;
  let mainWorkspace: string;
  let researchWorkspace: string;
  let memoryPath: string;
  let memoryDir: string;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-routes-test-'));
    mainWorkspace = path.join(homeDir, '.openclaw', 'workspace');
    researchWorkspace = path.join(homeDir, '.openclaw', 'workspace-research');
    memoryPath = path.join(mainWorkspace, 'MEMORY.md');
    memoryDir = path.join(mainWorkspace, 'memory');

    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(researchWorkspace, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.resetModules();
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false,
        port: 3000,
        host: '127.0.0.1',
        sslPort: 3443,
        home: homeDir,
        memoryPath,
        memoryDir,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));

    const mod = await import('./skills.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  function setupExec(stdout: string, stderr = '') {
    const calls: ExecCall[] = [];

    execFileImpl = (bin, args, opts, cb) => {
      calls.push({ bin, args, opts: opts as Record<string, unknown> | undefined });

      if (args[0] === 'config' && args[1] === 'set') {
        cb(null, '', '');
        return;
      }

      if (args[0] === 'skills' && args[1] === 'list' && args[2] === '--json') {
        cb(null, stdout, stderr);
        return;
      }

      cb(Object.assign(new Error(`Unexpected exec: ${args.join(' ')}`), { code: 'EINVAL' }), '', '');
    };

    return calls;
  }

  it('returns skill list on success', async () => {
    setupExec(GOOD_SKILLS_JSON);

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
    expect(json.skills[0].name).toBe('weather');
  });

  it('executes the scoped skills listing against the requested agent workspace', async () => {
    const calls = setupExec(GOOD_SKILLS_JSON);

    const app = await buildApp();
    const res = await app.request('/api/skills?agentId=research');

    expect(res.status).toBe(200);
    const configSetCall = findExecCall(calls, ['config', 'set', 'agents.defaults.workspace', researchWorkspace]);
    const skillsCall = findExecCall(calls, ['skills', 'list', '--json']);

    expect(configSetCall).toBeDefined();
    expect(skillsCall?.opts).toEqual(expect.objectContaining({ cwd: researchWorkspace }));
  });

  it('falls back to the main workspace when agentId is omitted', async () => {
    const calls = setupExec(GOOD_SKILLS_JSON);

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const configSetCall = findExecCall(calls, ['config', 'set', 'agents.defaults.workspace', mainWorkspace]);
    const skillsCall = findExecCall(calls, ['skills', 'list', '--json']);

    expect(configSetCall).toBeDefined();
    expect(skillsCall?.opts).toEqual(expect.objectContaining({ cwd: mainWorkspace }));
  });

  it('parses skills when warnings are printed before JSON', async () => {
    setupExec(`Config warnings: duplicate plugin id\n${GOOD_SKILLS_JSON}`);

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
  });

  it('parses skills when warning prelude contains bracket characters', async () => {
    setupExec(`[warn] duplicate plugin id\n${GOOD_SKILLS_JSON}`);

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
  });

  it('parses top-level skills array when warnings are printed before JSON', async () => {
    setupExec(`Config warnings: noisy prelude\n${GOOD_SKILLS_ARRAY_JSON}`);

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; skills: Array<{ name: string }> };
    expect(json.ok).toBe(true);
    expect(json.skills).toHaveLength(2);
    expect(json.skills[1].name).toBe('github');
  });

  it('fails loud when openclaw binary is missing', async () => {
    execFileImpl = (_bin, args, _opts, cb) => {
      if (args[0] === 'config' && args[1] === 'set') {
        cb(null, '', '');
        return;
      }

      const err = Object.assign(new Error('spawn /usr/bin/openclaw ENOENT'), { code: 'ENOENT' });
      cb(err, '', '');
    };

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not found/i);
  });

  it('fails loud on invalid JSON output', async () => {
    setupExec('not json');

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/parse/i);
  });

  it('fails loud when JSON payload has no skills array', async () => {
    setupExec(JSON.stringify({ workspaceDir: '/tmp/workspace' }));

    const app = await buildApp();
    const res = await app.request('/api/skills');

    expect(res.status).toBe(502);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/missing skills array/i);
  });

  it('includes skill detail fields in response', async () => {
    setupExec(GOOD_SKILLS_JSON);

    const app = await buildApp();
    const res = await app.request('/api/skills');

    const json = (await res.json()) as { skills: Array<Record<string, unknown>> };
    const skill = json.skills[0];
    expect(skill).toHaveProperty('name');
    expect(skill).toHaveProperty('description');
    expect(skill).toHaveProperty('eligible');
    expect(skill).toHaveProperty('bundled');
  });
});
