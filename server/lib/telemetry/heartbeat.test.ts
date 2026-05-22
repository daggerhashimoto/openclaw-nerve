// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildHeartbeatPayload,
  nextDailyHeartbeatAt,
  shouldSendDailyCatchUp,
  shouldSendFirstSeen,
  shouldSendVersionChange,
} from './heartbeat.js';

describe('telemetry heartbeat helpers', () => {
  it('builds a daily heartbeat payload with exact active_24h semantics', () => {
    const payload = buildHeartbeatPayload({
      identity: { instanceId: 'uuid' },
      installMethod: 'release',
      appVersion: '1.5.2',
      reason: 'daily',
      snapshot: {
        counts24h: { sessions_created: 0, messages_sent: 0, tool_calls: 0 },
        featuresUsed24h: { chat: false, sessions: false, branches: false, kanban: false, settings: false },
        windowStart: '2026-04-20T00:00:00Z',
        windowEnd: '2026-04-21T00:00:00Z',
      },
    });

    expect(payload.active_24h).toBe(false);
  });

  it('treats any feature usage as active_24h even with zero counters', () => {
    const payload = buildHeartbeatPayload({
      identity: { instanceId: 'uuid' },
      installMethod: 'source',
      appVersion: '1.5.2',
      reason: 'version_change',
      snapshot: {
        counts24h: { sessions_created: 0, messages_sent: 0, tool_calls: 0 },
        featuresUsed24h: { chat: false, sessions: false, branches: true, kanban: false, settings: false },
        windowStart: '2026-04-20T00:00:00Z',
        windowEnd: '2026-04-21T00:00:00Z',
      },
    });

    expect(payload.active_24h).toBe(true);
  });

  it('only sends first_seen when it has not been sent before', () => {
    expect(shouldSendFirstSeen({})).toBe(true);
    expect(shouldSendFirstSeen({ first_seen: '2026-04-21T00:00:00Z' })).toBe(false);
  });

  it('sends version_change only when the app version differs from the last heartbeat', () => {
    expect(shouldSendVersionChange({ appVersion: '1.5.2' })).toBe(false);
    expect(shouldSendVersionChange({ appVersion: '1.5.2', lastHeartbeatAppVersion: '1.5.1' })).toBe(true);
    expect(shouldSendVersionChange({ appVersion: '1.5.2', lastHeartbeatAppVersion: '1.5.2' })).toBe(false);
  });

  it('sends a startup daily catch-up only after the UTC daily target has passed', () => {
    expect(shouldSendDailyCatchUp({
      now: new Date('2026-04-21T00:05:00Z'),
      jitterMs: 10 * 60 * 1000,
      lastHeartbeatSentAtByReason: {},
    })).toBe(false);

    expect(shouldSendDailyCatchUp({
      now: new Date('2026-04-21T12:00:00Z'),
      jitterMs: 10 * 60 * 1000,
      lastHeartbeatSentAtByReason: {},
    })).toBe(true);

    expect(shouldSendDailyCatchUp({
      now: new Date('2026-04-21T12:00:00Z'),
      jitterMs: 10 * 60 * 1000,
      lastHeartbeatSentAtByReason: { daily: '2026-04-21T00:10:00.000Z' },
    })).toBe(false);
  });

  it('schedules the next daily heartbeat at the next UTC day target with jitter', () => {
    expect(nextDailyHeartbeatAt(new Date('2026-04-21T00:05:00Z'), 10 * 60 * 1000).toISOString())
      .toBe('2026-04-21T00:10:00.000Z');

    expect(nextDailyHeartbeatAt(new Date('2026-04-21T00:15:00Z'), 10 * 60 * 1000).toISOString())
      .toBe('2026-04-22T00:10:00.000Z');
  });
});
