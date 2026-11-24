/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function importRoute() {
  vi.resetModules();
  return import('./upload-config.js');
}

const ENV_KEYS = [
  'NERVE_UPLOAD_TWO_MODE_ENABLED',
  'NERVE_UPLOAD_INLINE_ENABLED',
  'NERVE_UPLOAD_FILE_REFERENCE_ENABLED',
  'NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('GET /api/upload-config', () => {
  it('returns upload capability defaults when env overrides are absent', async () => {
    for (const key of ENV_KEYS) delete process.env[key];

    const { default: app } = await importRoute();
    const res = await app.request('/api/upload-config');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      twoModeEnabled: false,
      inlineEnabled: true,
      fileReferenceEnabled: false,
      inlineAttachmentMaxMb: 4,
    });
  });

  it('returns env-backed capability flags for the existing client contract', async () => {
    process.env.NERVE_UPLOAD_TWO_MODE_ENABLED = 'true';
    process.env.NERVE_UPLOAD_INLINE_ENABLED = 'true';
    process.env.NERVE_UPLOAD_FILE_REFERENCE_ENABLED = 'true';
    process.env.NERVE_UPLOAD_INLINE_ATTACHMENT_MAX_MB = '8';

    const { default: app } = await importRoute();
    const res = await app.request('/api/upload-config');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      twoModeEnabled: true,
      inlineEnabled: true,
      fileReferenceEnabled: true,
      inlineAttachmentMaxMb: 8,
    });
  });
});
