import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('workspace routes', () => {
  let homeDir: string;
  let mainWorkspace: string;
  let researchWorkspace: string;
  let memoryPath: string;
  let memoryDir: string;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-routes-test-'));
    mainWorkspace = path.join(homeDir, '.openclaw', 'workspace');
    researchWorkspace = path.join(homeDir, '.openclaw', 'workspace-research');
    memoryPath = path.join(mainWorkspace, 'MEMORY.md');
    memoryDir = path.join(mainWorkspace, 'memory');

    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(researchWorkspace, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.resetModules();
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false,
        port: 3000,
        host: '127.0.0.1',
        sslPort: 3443,
        home: homeDir,
        memoryPath,
        memoryDir,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));

    const mod = await import('./workspace.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  it('reads allowlisted files from the requested agent workspace', async () => {
    await fs.writeFile(path.join(mainWorkspace, 'TOOLS.md'), 'main tools');
    await fs.writeFile(path.join(researchWorkspace, 'TOOLS.md'), 'research tools');

    const app = await buildApp();
    const res = await app.request('/api/workspace/tools?agentId=research');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; content: string };
    expect(json.ok).toBe(true);
    expect(json.content).toBe('research tools');
  });

  it('writes allowlisted files into the requested agent workspace', async () => {
    await fs.writeFile(path.join(mainWorkspace, 'SOUL.md'), 'main soul');

    const app = await buildApp();
    const res = await app.request('/api/workspace/soul', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'research', content: 'research soul' }),
    });

    expect(res.status).toBe(200);
    await expect(fs.readFile(path.join(researchWorkspace, 'SOUL.md'), 'utf-8')).resolves.toBe('research soul');
    await expect(fs.readFile(path.join(mainWorkspace, 'SOUL.md'), 'utf-8')).resolves.toBe('main soul');
  });

  it('lists file existence for the requested agent workspace', async () => {
    await fs.writeFile(path.join(mainWorkspace, 'USER.md'), 'main user');
    await fs.writeFile(path.join(researchWorkspace, 'TOOLS.md'), 'research tools');

    const app = await buildApp();
    const res = await app.request('/api/workspace?agentId=research');

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      files: Array<{ key: string; exists: boolean }>;
    };

    expect(json.ok).toBe(true);
    expect(json.files.find((file) => file.key === 'tools')?.exists).toBe(true);
    expect(json.files.find((file) => file.key === 'user')?.exists).toBe(false);
  });

    it('rejects invalid agent ids', async () => {
      const app = await buildApp();
      const res = await app.request('/api/workspace?agentId=../bad');

      expect(res.status).toBe(400);
      const json = (await res.json()) as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
      expect(json.error).toContain('Invalid agent id');
    });
});
