// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildErrorPayload } from './error-reporting.js';

describe('telemetry error reporting', () => {
  it('drops forbidden fields from error telemetry', () => {
    const error = new Error('Bearer top-secret from /Users/alice/nerve plus prompt=hello');
    error.name = 'TypeError';
    error.stack = [
      'TypeError: Bearer top-secret from /Users/alice/nerve',
      '    at loadSession (/Users/alice/nerve/server/routes/sessions.ts:10:2)',
    ].join('\n');
    Object.assign(error, {
      code: 'E_SESSION_LOAD_FAILED',
      headers: { authorization: 'Bearer top-secret' },
      cookies: 'session=abc123',
      requestBody: '{"prompt":"hello"}',
      env: { OPENAI_API_KEY: 'sk-secret' },
      metadata: { path: '/Users/alice/nerve' },
    });

    const payload = buildErrorPayload({
      identity: { instanceId: 'uuid-1234' },
      appVersion: '1.5.2',
      installMethod: 'release',
      surface: 'api',
      error,
      occurredAt: '2026-04-21T00:00:00Z',
    });

    expect(payload).toEqual({
      schema_version: 1,
      instance_id: 'uuid-1234',
      app_version: '1.5.2',
      install_method: 'release',
      error_kind: 'server_exception',
      error_code: 'E_SESSION_LOAD_FAILED',
      surface: 'api',
      fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      occurred_at: '2026-04-21T00:00:00.000Z',
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('Bearer top-secret');
    expect(serialized).not.toContain('/Users/alice/nerve');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('session=abc123');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('sk-secret');
  });

  it('coerces unsafe error codes to UNKNOWN', () => {
    const error = new Error('boom');
    Object.assign(error, {
      code: 'Bearer top-secret',
    });

    const payload = buildErrorPayload({
      identity: { instanceId: 'uuid-1234' },
      appVersion: '1.5.2',
      installMethod: 'unknown',
      surface: 'api',
      error,
    });

    expect(payload.error_code).toBe('UNKNOWN');
  });
});
