import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatPathLinksTemplate } from '../lib/chat-path-links-config.js';

describe('workspace routes', () => {
  let homeDir: string;
  let mainWorkspace: string;
  let researchWorkspace: string;
  let memoryPath: string;
  let memoryDir: string;
  let originalHome: string | undefined;
  let originalUser: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-routes-test-'));
    mainWorkspace = path.join(homeDir, '.openclaw', 'workspace');
    researchWorkspace = path.join(homeDir, '.openclaw', 'workspace-research');
    memoryPath = path.join(mainWorkspace, 'MEMORY.md');
    memoryDir = path.join(mainWorkspace, 'memory');
    originalHome = process.env.HOME;
    originalUser = process.env.USER;
    process.env.HOME = homeDir;
    process.env.USER = 'tester';

    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(researchWorkspace, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    process.env.USER = originalUser;
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

  it('self-heals missing local CHAT_PATH_LINKS.json using the shared template', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = await buildApp();

    const res = await app.request('/api/workspace/chatPathLinks');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; content: string };
    expect(json.ok).toBe(true);

    const expected = createChatPathLinksTemplate({
      platform: process.platform,
      homeDir: homeDir,
      workspaceRoot: mainWorkspace,
    });

    expect(json.content).toBe(expected);
    await expect(fs.readFile(path.join(mainWorkspace, 'CHAT_PATH_LINKS.json'), 'utf-8')).resolves.toBe(expected);
    expect(warnSpy).toHaveBeenCalledWith(
      `[workspace] Missing CHAT_PATH_LINKS.json; regenerated local default template at ${path.join(mainWorkspace, 'CHAT_PATH_LINKS.json')}`,
    );
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

  describe('remote workspace (gateway fallback)', () => {
    let gatewayFilesGetMock: ReturnType<typeof vi.fn>;
    let gatewayFilesSetMock: ReturnType<typeof vi.fn>;
    let gatewayFilesListMock: ReturnType<typeof vi.fn>;
    // Use a workspace root that does NOT exist on disk to trigger remote detection
    let remoteHomeDir: string;
    let remoteWorkspace: string;

    beforeEach(async () => {
      remoteHomeDir = path.join(homeDir, 'remote-nonexistent');
      remoteWorkspace = path.join(remoteHomeDir, '.openclaw', 'workspace');
      // Do NOT create remoteWorkspace — it simulates a remote (sandbox) path

      gatewayFilesGetMock = vi.fn();
      gatewayFilesSetMock = vi.fn();
      gatewayFilesListMock = vi.fn();
    });

    async function buildRemoteApp() {
      vi.resetModules();
      vi.doMock('../lib/config.js', () => ({
        config: {
          auth: false,
          port: 3000,
          host: '127.0.0.1',
          sslPort: 3443,
          home: remoteHomeDir,
          memoryPath: path.join(remoteWorkspace, 'MEMORY.md'),
          memoryDir: path.join(remoteWorkspace, 'memory'),
          workspaceRemote: false,
        },
        SESSION_COOKIE_NAME: 'nerve_session_3000',
      }));
      vi.doMock('../middleware/rate-limit.js', () => ({
        rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      }));
      vi.doMock('../lib/gateway-rpc.js', () => ({
        gatewayFilesList: gatewayFilesListMock,
        gatewayFilesGet: gatewayFilesGetMock,
        gatewayFilesSet: gatewayFilesSetMock,
      }));
      // Clear workspace detect cache so it re-checks
      const detectMod = await import('../lib/workspace-detect.js');
      detectMod.clearWorkspaceDetectCache();

      const mod = await import('./workspace.js');
      const app = new Hono();
      app.route('/', mod.default);
      return app;
    }

    it('GET /api/workspace/:key falls back to gateway when local file missing', async () => {
      gatewayFilesGetMock.mockResolvedValue({
        name: 'SOUL.md',
        path: 'SOUL.md',
        missing: false,
        size: 100,
        updatedAtMs: 1000,
        content: '# Remote Soul',
      });

      const app = await buildRemoteApp();
      const res = await app.request('/api/workspace/soul');

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; content: string; remoteWorkspace?: boolean };
      expect(json.ok).toBe(true);
      expect(json.content).toBe('# Remote Soul');
      expect(json.remoteWorkspace).toBe(true);
    });

    it('GET /api/workspace/:key returns 404 when gateway also has no file', async () => {
      gatewayFilesGetMock.mockResolvedValue(null);

      const app = await buildRemoteApp();
      const res = await app.request('/api/workspace/soul');

      expect(res.status).toBe(404);
    });

    it('PUT /api/workspace/:key falls back to gateway for remote workspace', async () => {
      gatewayFilesSetMock.mockResolvedValue(undefined);

      // Force remote mode via config
      vi.resetModules();
      vi.doMock('../lib/config.js', () => ({
        config: {
          auth: false,
          port: 3000,
          host: '127.0.0.1',
          sslPort: 3443,
          home: remoteHomeDir,
          memoryPath: path.join(remoteWorkspace, 'MEMORY.md'),
          memoryDir: path.join(remoteWorkspace, 'memory'),
          workspaceRemote: true,
        },
        SESSION_COOKIE_NAME: 'nerve_session_3000',
      }));
      vi.doMock('../middleware/rate-limit.js', () => ({
        rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      }));
      vi.doMock('../lib/gateway-rpc.js', () => ({
        gatewayFilesList: gatewayFilesListMock,
        gatewayFilesGet: gatewayFilesGetMock,
        gatewayFilesSet: gatewayFilesSetMock,
      }));
      const detectMod = await import('../lib/workspace-detect.js');
      detectMod.clearWorkspaceDetectCache();

      const mod = await import('./workspace.js');
      const app = new Hono();
      app.route('/', mod.default);

      const res = await app.request('/api/workspace/soul', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Remote Soul' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; remoteWorkspace?: boolean };
      expect(json.ok).toBe(true);
      expect(json.remoteWorkspace).toBe(true);
      expect(gatewayFilesSetMock).toHaveBeenCalledWith('main', 'SOUL.md', '# Remote Soul');
    });

    it('PUT /api/workspace/:key returns 500 when gateway write fails', async () => {
      gatewayFilesSetMock.mockRejectedValue(new Error('Gateway write failed'));

      // Force remote mode via config
      vi.resetModules();
      vi.doMock('../lib/config.js', () => ({
        config: {
          auth: false,
          port: 3000,
          host: '127.0.0.1',
          sslPort: 3443,
          home: remoteHomeDir,
          memoryPath: path.join(remoteWorkspace, 'MEMORY.md'),
          memoryDir: path.join(remoteWorkspace, 'memory'),
          workspaceRemote: true,
        },
        SESSION_COOKIE_NAME: 'nerve_session_3000',
      }));
      vi.doMock('../middleware/rate-limit.js', () => ({
        rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
      }));
      vi.doMock('../lib/gateway-rpc.js', () => ({
        gatewayFilesList: gatewayFilesListMock,
        gatewayFilesGet: gatewayFilesGetMock,
        gatewayFilesSet: gatewayFilesSetMock,
      }));
      const detectMod = await import('../lib/workspace-detect.js');
      detectMod.clearWorkspaceDetectCache();

      const mod = await import('./workspace.js');
      const app = new Hono();
      app.route('/', mod.default);

      const res = await app.request('/api/workspace/soul', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Fail Soul' }),
      });

      expect(res.status).toBe(500);
      const json = (await res.json()) as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
    });

    it('GET /api/workspace/:key returns 404 when gateway read fails', async () => {
      gatewayFilesGetMock.mockResolvedValue(null);

      const app = await buildRemoteApp();
      const res = await app.request('/api/workspace/tools');

      expect(res.status).toBe(404);
      const json = (await res.json()) as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
    });

    it('GET /api/workspace lists files via gateway when workspace is remote', async () => {
      gatewayFilesListMock.mockResolvedValue([
        { name: 'SOUL.md', missing: false, size: 100, updatedAtMs: 1000 },
        { name: 'TOOLS.md', missing: true, size: 0, updatedAtMs: 0 },
      ]);

      const app = await buildRemoteApp();
      const res = await app.request('/api/workspace');

      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        ok: boolean;
        files: Array<{ key: string; exists: boolean }>;
        remoteWorkspace?: boolean;
      };
      expect(json.ok).toBe(true);
      expect(json.remoteWorkspace).toBe(true);
      expect(json.files.find((f) => f.key === 'soul')?.exists).toBe(true);
      expect(json.files.find((f) => f.key === 'tools')?.exists).toBe(false);
    });
  });
});
