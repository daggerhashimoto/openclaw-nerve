// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  bucketDurationMs,
  buildMessageSubmittedEvent,
  buildSessionCreatedEvent,
  buildToolCallCompletedEvent,
  coerceToolFamily,
} from './detailed-events.js';

describe('telemetry detailed event helpers', () => {
  it('coerces tool families and buckets tool duration for tool_call_completed', () => {
    const payload = buildToolCallCompletedEvent({
      identity: { instanceId: 'uuid-1234' },
      appVersion: '1.5.2',
      installMethod: 'source',
      surface: 'chat',
      toolName: 'web_search',
      success: true,
      startedAt: 1_000,
      finishedAt: 2_500,
      sentAt: '2026-04-21T00:05:02.000Z',
    });

    expect(payload.event).toBe('tool_call_completed');
    expect(payload.properties).toEqual({
      surface: 'chat',
      feature_area: 'chat',
      tool_name: 'web',
      success: true,
      duration_bucket: '1_5s',
    });
  });

  it('coerces unknown tools to other and exposes stable duration buckets', () => {
    expect(coerceToolFamily('custom_tool')).toBe('other');
    expect(bucketDurationMs(999)).toBe('lt_1s');
    expect(bucketDurationMs(1_000)).toBe('1_5s');
    expect(bucketDurationMs(5_000)).toBe('5_30s');
    expect(bucketDurationMs(30_001)).toBe('gt_30s');
  });

  it('keeps session_created and message_submitted properties on the allowlist', () => {
    const sessionCreated = buildSessionCreatedEvent({
      identity: { instanceId: 'uuid-1234' },
      appVersion: '1.5.2',
      installMethod: 'source',
      surface: 'sessions',
      sentAt: '2026-04-21T00:05:00.000Z',
    });
    const messageSubmitted = buildMessageSubmittedEvent({
      identity: { instanceId: 'uuid-1234' },
      appVersion: '1.5.2',
      installMethod: 'source',
      surface: 'chat',
      sentAt: '2026-04-21T00:05:01.000Z',
    });

    expect(sessionCreated.properties).toEqual({ surface: 'sessions', feature_area: 'sessions' });
    expect(messageSubmitted.properties).toEqual({ surface: 'chat', feature_area: 'chat' });
  });
});
