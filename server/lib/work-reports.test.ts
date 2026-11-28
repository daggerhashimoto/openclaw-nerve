import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendWorkReport,
  readWorkReports,
  resetWorkReportIndex,
  summarizeWorkReports,
  type WorkReport,
} from './work-reports.js';

function report(overrides: Partial<WorkReport> = {}): WorkReport {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    at: '2026-11-28T10:00:00.000Z',
    workstream: 'nerve',
    agent: { kind: 'claude-code', sessionId: 'abc' },
    repo: {
      path: '/Users/shaun/nerve',
      branch: 'master',
      commit: '5edad4f0000000000000000000000000000000000',
      dirty: false,
      changedFiles: 0,
    },
    outcome: { summary: 'Rebased the attention branch', status: 'completed' },
    observed: [{ kind: 'commit', text: '5edad4f flow fixes', ok: true }],
    ...overrides,
  };
}

describe('work report store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-reports-'));
    resetWorkReportIndex();
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    resetWorkReportIndex();
  });

  it('writes one JSONL file per UTC day and reads the report back', async () => {
    await appendWorkReport(dir, report());

    const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.jsonl'));
    expect(files).toEqual(['2026-11-28.jsonl']);

    const [stored] = await readWorkReports(dir);
    expect(stored.id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(stored.repo?.branch).toBe('master');
  });

  it('ignores a duplicate id, which is what a queued retry gets', async () => {
    const first = await appendWorkReport(dir, report());
    const second = await appendWorkReport(dir, report({ at: '2026-11-28T11:00:00.000Z' }));

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await readWorkReports(dir)).toHaveLength(1);
  });

  it('keeps two reports with different ids', async () => {
    await appendWorkReport(dir, report({ id: 'aaaaaaaa-0000-4000-8000-000000000001' }));
    await appendWorkReport(dir, report({ id: 'aaaaaaaa-0000-4000-8000-000000000002', at: '2026-11-28T11:00:00.000Z' }));

    const stored = await readWorkReports(dir);
    expect(stored).toHaveLength(2);
    expect(stored[0].at).toBe('2026-11-28T11:00:00.000Z');
  });

  it('filters by time, workstream and limit', async () => {
    await appendWorkReport(dir, report({ id: 'aaaaaaaa-0000-4000-8000-000000000001', at: '2026-11-27T09:00:00.000Z' }));
    await appendWorkReport(dir, report({ id: 'aaaaaaaa-0000-4000-8000-000000000002', at: '2026-11-28T09:00:00.000Z', workstream: 'swarm' }));
    await appendWorkReport(dir, report({ id: 'aaaaaaaa-0000-4000-8000-000000000003', at: '2026-11-28T10:00:00.000Z' }));

    expect(await readWorkReports(dir, { since: new Date('2026-11-28T00:00:00.000Z') })).toHaveLength(2);
    expect(await readWorkReports(dir, { workstream: 'swarm' })).toHaveLength(1);
    expect(await readWorkReports(dir, { limit: 1 })).toHaveLength(1);
  });

  it('skips a torn line without hiding the rest of the file', async () => {
    await appendWorkReport(dir, report());
    await fs.appendFile(path.join(dir, '2026-11-28.jsonl'), '{"id":"cut-off"');

    const stored = await readWorkReports(dir);
    expect(stored).toHaveLength(1);
  });

  it('rebuilds the id index when it is missing', async () => {
    await appendWorkReport(dir, report());
    await fs.rm(path.join(dir, '.ids'));
    resetWorkReportIndex();

    const second = await appendWorkReport(dir, report());
    expect(second.duplicate).toBe(true);
  });

  it('counts reported workstreams and observed verification separately', async () => {
    await appendWorkReport(dir, report({ id: 'aaaaaaaa-0000-4000-8000-000000000001' }));
    await appendWorkReport(dir, report({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      workstream: 'after-hours-net',
      at: '2026-11-28T11:00:00.000Z',
      outcome: { status: 'blocked' },
      repo: { path: '/Users/shaun/ahn', branch: 'main', commit: 'abc', dirty: true, changedFiles: 3 },
      observed: [
        { kind: 'test', text: 'pytest', ok: false },
        { kind: 'build', text: 'npm run build', ok: true },
      ],
    }));

    const summary = summarizeWorkReports(await readWorkReports(dir));
    expect(summary.counts.reports).toBe(2);
    expect(summary.counts.byWorkstream).toEqual({ nerve: 1, 'after-hours-net': 1 });
    expect(summary.counts.dirtyRepos).toBe(1);
    expect(summary.observed.tests).toBe(1);
    expect(summary.observed.failed).toBe(1);
    expect(summary.observed.builds).toBe(1);
    expect(summary.reports[0].id).toBe('aaaaaaaa-0000-4000-8000-000000000002');
  });
});
