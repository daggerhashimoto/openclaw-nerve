/**
 * Durable storage for work reports pushed by machines that are not this one.
 *
 * A report is a small JSON document: what a coding session did, on which repo
 * and commit, plus the verification the reporter actually observed. Reports are
 * appended to one JSONL file per UTC day so a crash can only lose the tail of a
 * single line, and ids are kept in a side index so a queued retry is stored
 * once.
 *
 * The store never interprets a report's prose. `reported` claims and `observed`
 * facts stay in separate fields all the way to the digest, so the reader can
 * tell "the session said it was done" from "the reporter saw a clean build".
 * @module
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createMutex } from './mutex.js';

/** A fact the reporter itself observed. */
export interface ObservedWork {
  kind: 'test' | 'build' | 'lint' | 'commit' | 'push' | 'pr' | 'merge' | 'other';
  text: string;
  ok?: boolean;
  at?: string;
}

/** Repository state captured at report time. */
export interface ReportedRepo {
  path: string;
  remote?: string;
  branch: string;
  commit: string;
  commitSubject?: string;
  dirty: boolean;
  changedFiles: number;
  ahead?: number;
  behind?: number;
  upstream?: string;
}

/** What the session claims it did, kept apart from observed facts. */
export interface ReportedOutcome {
  summary?: string;
  claims?: string[];
  status: 'completed' | 'partial' | 'blocked' | 'aborted';
}

/** A single push from a reporter machine. */
export interface WorkReport {
  id: string;
  at: string;
  workstream: string;
  agent: {
    kind: string;
    sessionId?: string;
    model?: string;
  };
  repo?: ReportedRepo;
  outcome?: ReportedOutcome;
  observed?: ObservedWork[];
  links?: {
    pr?: string;
    commit?: string;
    issue?: string;
  };
  meta?: {
    hostname?: string;
    reporterVersion?: string;
    queuedAt?: string;
  };
}

export interface WorkReportQuery {
  since?: Date;
  until?: Date;
  workstream?: string;
  limit?: number;
}

export interface WorkReportSummary {
  range: { since: string | null; until: string | null };
  counts: {
    reports: number;
    byWorkstream: Record<string, number>;
    byStatus: Record<string, number>;
    repos: number;
    dirtyRepos: number;
  };
  observed: {
    tests: number;
    passed: number;
    failed: number;
    builds: number;
    commits: number;
    pushes: number;
    prs: number;
    merges: number;
  };
  reports: WorkReport[];
}

const ID_INDEX_FILE = '.ids';
const withLock = createMutex();

let knownIds: Set<string> | null = null;
let knownIdsDir = '';

/** Directory holds one file per UTC day. */
function dayFileFor(dir: string, at: Date): string {
  return path.join(dir, `${at.toISOString().slice(0, 10)}.jsonl`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

async function readDirFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function readReportsFromFile(file: string): Promise<WorkReport[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const reports: WorkReport[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as WorkReport;
      if (parsed && typeof parsed.id === 'string') reports.push(parsed);
    } catch {
      // A torn tail line must not hide every report before it.
      console.warn(`[work-reports] skipping unparseable line in ${path.basename(file)}`);
    }
  }
  return reports;
}

/** Build the id set once, then keep it in memory as reports are appended. */
async function loadKnownIds(dir: string): Promise<Set<string>> {
  if (knownIds && knownIdsDir === dir) return knownIds;

  const ids = new Set<string>();
  try {
    const raw = await fs.readFile(path.join(dir, ID_INDEX_FILE), 'utf8');
    for (const line of raw.split('\n')) if (line.trim()) ids.add(line.trim());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    for (const file of await readDirFiles(dir)) {
      for (const report of await readReportsFromFile(path.join(dir, file))) ids.add(report.id);
    }
    await ensureDir(dir);
    await fs.writeFile(
      path.join(dir, ID_INDEX_FILE),
      ids.size > 0 ? `${[...ids].join('\n')}\n` : '',
      { mode: 0o600 },
    );
  }

  knownIds = ids;
  knownIdsDir = dir;
  return ids;
}

/** Forget the cached index. Tests use it; the server never needs to. */
export function resetWorkReportIndex(): void {
  knownIds = null;
  knownIdsDir = '';
}

export interface AppendResult {
  duplicate: boolean;
  storedAt: string;
}

/**
 * Append a report, once. A duplicate id returns `duplicate: true` without
 * writing, which is what a reporter's queued retry should get.
 */
export async function appendWorkReport(dir: string, report: WorkReport): Promise<AppendResult> {
  return withLock(async () => {
    const ids = await loadKnownIds(dir);
    const storedAt = new Date().toISOString();
    if (ids.has(report.id)) return { duplicate: true, storedAt };

    await ensureDir(dir);
    const at = new Date(report.at);
    const file = dayFileFor(dir, Number.isNaN(at.getTime()) ? new Date() : at);
    await fs.appendFile(file, `${JSON.stringify(report)}\n`, { mode: 0o600 });
    await fs.appendFile(path.join(dir, ID_INDEX_FILE), `${report.id}\n`, { mode: 0o600 });
    ids.add(report.id);

    return { duplicate: false, storedAt };
  });
}

/** Read reports newest first, filtered by time and workstream. */
export async function readWorkReports(dir: string, query: WorkReportQuery = {}): Promise<WorkReport[]> {
  const sinceMs = query.since?.getTime() ?? 0;
  const untilMs = query.until?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const reports: WorkReport[] = [];

  for (const file of await readDirFiles(dir)) {
    // The file name is the day; skip whole days outside the range.
    const dayStart = Date.parse(`${file.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(dayStart)) continue;
    if (dayStart > untilMs || dayStart + 86_400_000 < sinceMs) continue;

    for (const report of await readReportsFromFile(path.join(dir, file))) {
      const at = Date.parse(report.at);
      if (Number.isNaN(at) || at < sinceMs || at > untilMs) continue;
      if (query.workstream && report.workstream !== query.workstream) continue;
      reports.push(report);
    }
  }

  reports.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return typeof query.limit === 'number' ? reports.slice(0, query.limit) : reports;
}

/** Aggregate a set of reports for a daily brief. */
export function summarizeWorkReports(reports: WorkReport[]): WorkReportSummary {
  const byWorkstream: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const repos = new Set<string>();
  let dirtyRepos = 0;

  const observed = { tests: 0, passed: 0, failed: 0, builds: 0, commits: 0, pushes: 0, prs: 0, merges: 0 };

  for (const report of reports) {
    byWorkstream[report.workstream] = (byWorkstream[report.workstream] ?? 0) + 1;
    const status = report.outcome?.status ?? 'unknown';
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    if (report.repo) {
      repos.add(`${report.repo.path}@${report.repo.branch}`);
      if (report.repo.dirty) dirtyRepos += 1;
    }

    for (const fact of report.observed ?? []) {
      if (fact.kind === 'test') {
        observed.tests += 1;
        if (fact.ok === true) observed.passed += 1;
        if (fact.ok === false) observed.failed += 1;
      } else if (fact.kind === 'build') observed.builds += 1;
      else if (fact.kind === 'commit') observed.commits += 1;
      else if (fact.kind === 'push') observed.pushes += 1;
      else if (fact.kind === 'pr') observed.prs += 1;
      else if (fact.kind === 'merge') observed.merges += 1;
    }
  }

  const sorted = [...reports].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    range: {
      since: sorted.length > 0 ? sorted[sorted.length - 1].at : null,
      until: sorted.length > 0 ? sorted[0].at : null,
    },
    counts: {
      reports: reports.length,
      byWorkstream,
      byStatus,
      repos: repos.size,
      dirtyRepos,
    },
    observed,
    reports: sorted,
  };
}
