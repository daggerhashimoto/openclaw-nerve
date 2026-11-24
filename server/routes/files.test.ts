/** Tests for the image file serving route (GET /api/files). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('GET /api/files', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'files-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        memoryDir: tmpDir,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));

    const mod = await import('./files.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('returns 400 when path parameter is missing', async () => {
    const app = await buildApp();
    const res = await app.request('/api/files');
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-image file types', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'hello');
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(403);
  });

  it('serves PNG images with correct content type', async () => {
    const filePath = path.join(tmpDir, 'test.png');
    const fakeData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    await fs.writeFile(filePath, fakeData);
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('serves JPEG images', async () => {
    const filePath = path.join(tmpDir, 'test.jpg');
    await fs.writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff]));
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('returns 404 for non-existent file', async () => {
    const app = await buildApp();
    const fakePath = path.join(tmpDir, 'nope.png');
    const res = await app.request(`/api/files?path=${encodeURIComponent(fakePath)}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for paths outside allowed prefixes', async () => {
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent('/etc/passwd.png')}`);
    expect(res.status).toBe(403);
  });

  it('forces Content-Disposition: attachment for SVGs', async () => {
    const filePath = path.join(tmpDir, 'test.svg');
    await fs.writeFile(filePath, '<svg></svg>');
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
  });

  it('sets cache headers', async () => {
    const filePath = path.join(tmpDir, 'test.webp');
    await fs.writeFile(filePath, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const app = await buildApp();
    const res = await app.request(`/api/files?path=${encodeURIComponent(filePath)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
  });
});
