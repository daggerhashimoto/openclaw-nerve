import { describe, expect, it } from 'vitest';
import { createSession, verifySession } from './session.js';

const secret = 'test-secret';
const ttlMs = 1000 * 60 * 60;

describe('session', () => {
  it('creates and verifies a signed session token', () => {
    const token = createSession(secret, ttlMs, {
      orgId: 'acme',
      organizationName: 'Acme Co.',
      userId: 'admin',
      userName: 'Administrator',
    });

    const payload = verifySession(token, secret);

    expect(payload).not.toBeNull();
    expect(payload?.orgId).toBe('acme');
    expect(payload?.organizationName).toBe('Acme Co.');
    expect(payload?.userId).toBe('admin');
    expect(payload?.userName).toBe('Administrator');
  });

  it('rejects an expired session', async () => {
    const token = createSession(secret, 1, { orgId: 'acme' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(verifySession(token, secret)).toBeNull();
  });
});
