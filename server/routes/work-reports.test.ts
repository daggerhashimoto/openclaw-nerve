import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TEST_TOKEN = 'a'.repeat(64);
let reportsDir = '';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    at: '2026-11-28T10:00:00.000Z',
    workstream: 'nerve',
    agent: { kind: 'claude-code', sessionId: 's1' },
    repo: {
      path: '/Users/shaun/nerve',
      branch: 'master',
      commit: '5edad4f',
      dirty: true,
      changedFiles: 2,
    },
    outcome: { summary: 'Rebased the branch', status: 'completed' },
    observed: [{ kind: 'test', text: 'npm test', ok: true }],
    ...overrides,
  };
}

async function buildApp({ token = TEST_TOKEN, auth = false }: { token?: string; auth?: boolean } = {}) {
  vi.resetModules();
  const configModule = await import('../lib/config.js');
  (configModule.config as unknown as Record<string, unknown>).reporterToken = token;
  (configModule.config as unknown as Record<string, unknown>).workReportsDir = reportsDir;
  (configModule.config as unknown as Record<string, unknown>).auth = auth;
  const workReports = await import('./work-reports.js');
  const app = new Hono();
  app.route('/', workReports.default);
  return { app, config: configModule.config };
}

const authHeader = { Authorization: `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' };

describe('work report routes', () => {
  beforeEach(async () => {
    reportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'work-reports-route-'));
  });

  afterEach(async () => {
    await fs.rm(reportsDir, { recursive: true, force: true });
  });

  it('refuses to store anything when the server has no reporter token', async () => {
    const { app } = await buildApp({ token: '' });
    const res = await app.request('/api/work/reports', {
      method: 'POST',
      headers: { ...authHeader },
      body: JSON.stringify(payload()),
    });

    expect(res.status).toBe(503);
  });

  it('rejects a wrong token', async () => {
    const { app } = await buildApp();
    const res = await app.request('/api/work/reports', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });

    expect(res.status).toBe(401);
  });

  it('stores a report and reports a retry as a duplicate', async () => {
    const { app } = await buildApp();
    const first = await app.request('/api/work/reports', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify(payload()),
    });
    const second = await app.request('/api/work/reports', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify(payload()),
    });

    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it('validates the payload', async () => {
    const { app } = await buildApp();
    const res = await app.request('/api/work/reports', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify(payload({ id: 'short' })),
    });

    expect(res.status).toBe(400);
  });

  it('requires auth to read reports when Nerve auth is on', async () => {
    const { app } = await buildApp({ auth: true });
    const res = await app.request('/api/work/reports');

    expect(res.status).toBe(401);
  });

  it('lets the reporter token read reports and the summary', async () => {
    const { app } = await buildApp();
    await app.request('/api/work/reports', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify(payload()),
    });

    const list = await app.request('/api/work/reports', { headers: { Authorization: `Bearer ${TEST_TOKEN}` } });
    const summary = await app.request('/api/work/reports/summary?since=2026-11-01T00:00:00.000Z', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(list.status).toBe(200);
    expect((await list.json()).count).toBe(1);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ ok: true, counts: { reports: 1 } });
  });

  it('answers a reporter ping only for a valid token', async () => {
    const { app } = await buildApp();

    expect((await app.request('/api/work/ping', { headers: { Authorization: `Bearer ${TEST_TOKEN}` } })).status).toBe(200);
    expect((await app.request('/api/work/ping', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('serves the installer and the CLI to a new machine', async () => {
    const { app } = await buildApp();

    const installer = await app.request('/install/mac-reporter.sh');
    const cli = await app.request('/install/nerve-report.mjs');

    expect(installer.status).toBe(200);
    expect(await installer.text()).toContain('Nerve work reporter');
    expect(cli.status).toBe(200);
    expect(await cli.text()).toContain('nerve-report');
  });
});
