// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createTelemetryStore } from './store.js';

describe('telemetry store', () => {
  let tempDir: string;
  let stateFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerve-telemetry-store-'));
    stateFile = path.join(tempDir, 'phase1-state.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rolls counters and booleans inside a trailing 24h window', async () => {
    const store = createTelemetryStore({ stateFile });

    await store.recordMessageSubmitted(new Date('2026-04-21T00:00:00Z'));
    await store.recordToolCompleted({
      toolName: 'read',
      success: true,
      startedAt: 0,
      finishedAt: 500,
      occurredAt: new Date('2026-04-21T00:00:01Z'),
    });

    const snapshot = await store.readWindow(new Date('2026-04-21T12:00:00Z'));
    expect(snapshot.counts24h).toEqual({ sessions_created: 0, messages_sent: 1, tool_calls: 1 });
    expect(snapshot.featuresUsed24h.chat).toBe(true);
    expect(snapshot.active24h).toBe(true);
  });

  it('prunes expired counters and feature flags outside the trailing 24h window', async () => {
    const store = createTelemetryStore({ stateFile });

    await store.recordSessionCreated(new Date('2026-04-19T10:00:00Z'));
    await store.recordSessionCreated(new Date('2026-04-20T13:00:00Z'));
    await store.markFeatureUsed('kanban', new Date('2026-04-19T10:00:00Z'));
    await store.markFeatureUsed('settings', new Date('2026-04-21T11:30:00Z'));

    const snapshot = await store.readWindow(new Date('2026-04-21T12:00:00Z'));
    expect(snapshot.counts24h).toEqual({ sessions_created: 1, messages_sent: 0, tool_calls: 0 });
    expect(snapshot.featuresUsed24h).toMatchObject({
      chat: false,
      sessions: true,
      branches: false,
      kanban: false,
      settings: true,
    });

    const persisted = fs.readFileSync(stateFile, 'utf8');
    expect(persisted).not.toContain('2026-04-19T10:00:00.000Z');
  });

  it('stores only hashed session keys and reports first-seen once', async () => {
    const store = createTelemetryStore({ stateFile });

    const first = await store.markSessionSeen('agent:main:main');
    const second = await store.markSessionSeen('agent:main:main');

    expect(first.firstSeen).toBe(true);
    expect(second.firstSeen).toBe(false);
    expect(first.sessionHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const persisted = fs.readFileSync(stateFile, 'utf8');
    expect(persisted).toContain(first.sessionHash);
    expect(persisted).not.toContain('agent:main:main');
  });

  it('allows a deleted root session key to be counted again after it is cleared', async () => {
    const store = createTelemetryStore({ stateFile });

    const first = await store.markSessionSeen('agent:main:main');
    await store.clearSessionSeen('agent:main:main');
    const second = await store.markSessionSeen('agent:main:main');

    expect(first.firstSeen).toBe(true);
    expect(second.firstSeen).toBe(true);

    const persisted = fs.readFileSync(stateFile, 'utf8');
    expect(persisted).toContain(first.sessionHash);
    expect(persisted).not.toContain('agent:main:main');
  });

  it('tracks heartbeat send metadata for future scheduling', async () => {
    const store = createTelemetryStore({ stateFile });

    await store.noteHeartbeatSent({
      reason: 'first_seen',
      sentAt: '2026-04-21T00:00:00Z',
      appVersion: '1.5.2',
    });

    const snapshot = await store.readWindow('2026-04-21T12:00:00Z');
    expect(snapshot.lastHeartbeatSentAtByReason.first_seen).toBe('2026-04-21T00:00:00.000Z');
    expect(snapshot.lastHeartbeatAppVersion).toBe('1.5.2');
  });
});
