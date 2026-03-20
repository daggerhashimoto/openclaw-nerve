/** Tests for the memories API routes. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('memories routes', () => {
  let homeDir: string;
  let tmpDir: string;
  let researchWorkspace: string;
  let memoryPath: string;
  let memoryDir: string;
  let broadcastMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memories-test-'));
    tmpDir = path.join(homeDir, '.openclaw', 'workspace');
    researchWorkspace = path.join(homeDir, '.openclaw', 'workspace-research');
    memoryDir = path.join(tmpDir, 'memory');
    memoryPath = path.join(tmpDir, 'MEMORY.md');
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(researchWorkspace, { recursive: true });
    broadcastMock = vi.fn();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.resetModules();
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        home: homeDir,
        memoryPath,
        memoryDir,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    vi.doMock('../middleware/rate-limit.js', () => ({
      rateLimitGeneral: vi.fn((_c: unknown, next: () => Promise<void>) => next()),
    }));
    vi.doMock('../lib/gateway-client.js', () => ({
      invokeGatewayTool: vi.fn(async () => ({})),
    }));
    vi.doMock('./events.js', () => ({
      broadcast: broadcastMock,
    }));

    const mod = await import('./memories.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  async function loadFileWatcher() {
    vi.resetModules();

    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        home: homeDir,
        memoryPath,
        memoryDir,
        workspaceWatchRecursive: false,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));
    vi.doMock('../routes/events.js', () => ({
      broadcast: broadcastMock,
    }));

    return import('../lib/file-watcher.js');
  }

  async function waitForBroadcast(
    matcher: (call: Array<unknown>) => boolean,
    timeoutMs = 2000,
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (broadcastMock.mock.calls.some((call) => matcher(call as Array<unknown>))) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Timed out waiting for broadcast. Calls: ${JSON.stringify(broadcastMock.mock.calls)}`);
  }

  describe('GET /api/memories', () => {
    it('returns empty array when no memories exist', async () => {
      const app = await buildApp();
      const res = await app.request('/api/memories');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<unknown>;
      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(0);
    });

    it('parses sections and items from MEMORY.md', async () => {
      await fs.writeFile(memoryPath, `# MEMORY.md

## Preferences
- Dark mode enabled
- Timezone is UTC+3

## Decisions
- Use Hono over Express
`);

      const app = await buildApp();
      const res = await app.request('/api/memories');
      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<{ type: string; text: string }>;

      const sections = json.filter(m => m.type === 'section');
      expect(sections).toHaveLength(2);
      expect(sections[0].text).toBe('Preferences');

      const items = json.filter(m => m.type === 'item');
      expect(items).toHaveLength(3);
      expect(items[0].text).toBe('Dark mode enabled');
    });

    it('includes daily file entries', async () => {
      await fs.writeFile(path.join(memoryDir, '2026-02-26.md'), `## Morning standup
- Discussed roadmap
`);

      const app = await buildApp();
      const res = await app.request('/api/memories');
      const json = (await res.json()) as Array<{ type: string; text: string; date?: string }>;

      const daily = json.filter(m => m.type === 'daily');
      expect(daily.length).toBeGreaterThanOrEqual(1);
      expect(daily[0].date).toBe('2026-02-26');
      expect(daily[0].text).toBe('Morning standup');
    });
  });

  describe('agent-scoped memories', () => {
    it('reads MEMORY.md from the requested agent workspace', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      await fs.writeFile(memoryPath, '# MEMORY.md\n\n## Main Facts\n- Main only\n');
      await fs.writeFile(
        path.join(researchWorkspace, 'MEMORY.md'),
        '# MEMORY.md\n\n## Research Facts\n- Research only\n',
      );

      const app = await buildApp();
      const res = await app.request('/api/memories?agentId=research');

      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<{ type: string; text: string }>;
      const texts = json.map((item) => item.text);
      expect(texts).toContain('Research Facts');
      expect(texts).toContain('Research only');
      expect(texts).not.toContain('Main Facts');
      expect(texts).not.toContain('Main only');
    });

    it('writes memories into the requested agent workspace and broadcasts agentId', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      await fs.writeFile(path.join(researchWorkspace, 'MEMORY.md'), '# MEMORY.md\n');

      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', text: 'Research fact', section: 'Facts' }),
      });

      expect(res.status).toBe(200);
      await expect(fs.readFile(path.join(researchWorkspace, 'MEMORY.md'), 'utf-8')).resolves.toContain('Research fact');
      await expect(fs.readFile(memoryPath, 'utf-8')).resolves.not.toContain('Research fact');
      expect(broadcastMock).toHaveBeenCalledWith(
        'memory.changed',
        expect.objectContaining({ agentId: 'research', action: 'create', section: 'Facts' }),
      );
    });
  });

  describe('POST /api/memories', () => {
    it('returns 400 when text is empty', async () => {
      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '' }),
      });
      expect(res.status).toBe(400);
    });

    it('creates a new memory in MEMORY.md', async () => {
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Remember this fact', section: 'Facts' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; result: { written: boolean; section: string } };
      expect(json.ok).toBe(true);
      expect(json.result.section).toBe('Facts');

      // Verify file was updated
      const content = await fs.readFile(memoryPath, 'utf-8');
      expect(content).toContain('## Facts');
      expect(content).toContain('- Remember this fact');
    });

    it('uses "General" as default section', async () => {
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      const app = await buildApp();
      await app.request('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'No section specified' }),
      });
      const content = await fs.readFile(memoryPath, 'utf-8');
      expect(content).toContain('## General');
    });

    it('appends to existing section', async () => {
      await fs.writeFile(memoryPath, `# MEMORY.md

## Facts
- Existing fact
`);
      const app = await buildApp();
      await app.request('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Another fact', section: 'Facts' }),
      });
      const content = await fs.readFile(memoryPath, 'utf-8');
      expect(content).toContain('- Existing fact');
      expect(content).toContain('- Another fact');
    });
  });

  describe('DELETE /api/memories', () => {
    it('returns 400 when query is empty', async () => {
      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      });
      expect(res.status).toBe(400);
    });

    it('deletes an item from MEMORY.md', async () => {
      await fs.writeFile(memoryPath, `# MEMORY.md

## Preferences
- Dark mode
- Light mode
`);
      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Dark mode', type: 'item' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; result: { deleted: number } };
      expect(json.ok).toBe(true);
      expect(json.result.deleted).toBe(1);

      const content = await fs.readFile(memoryPath, 'utf-8');
      expect(content).not.toContain('Dark mode');
      expect(content).toContain('Light mode');
    });

    it('deletes a section from MEMORY.md', async () => {
      await fs.writeFile(memoryPath, `# MEMORY.md

## Section A
- Item 1

## Section B
- Item 2
`);
      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Section A', type: 'section' }),
      });
      expect(res.status).toBe(200);
      const content = await fs.readFile(memoryPath, 'utf-8');
      expect(content).not.toContain('Section A');
      expect(content).toContain('Section B');
    });

    it('returns 404 when memory not found', async () => {
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      const app = await buildApp();
      const res = await app.request('/api/memories', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'nonexistent item' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/memories/section', () => {
    it('returns section content', async () => {
      await fs.writeFile(memoryPath, `# MEMORY.md

## My Section
- Item 1
- Item 2
`);
      const app = await buildApp();
      const res = await app.request('/api/memories/section?title=My%20Section');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; content: string };
      expect(json.ok).toBe(true);
      expect(json.content).toContain('Item 1');
    });

    it('returns 400 when title is missing', async () => {
      const app = await buildApp();
      const res = await app.request('/api/memories/section');
      expect(res.status).toBe(400);
    });

    it('returns 404 when section not found', async () => {
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      const app = await buildApp();
      const res = await app.request('/api/memories/section?title=Nonexistent');
      expect(res.status).toBe(404);
    });

    it('validates date format to prevent traversal', async () => {
      const app = await buildApp();
      const res = await app.request('/api/memories/section?title=Test&date=../../etc');
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/memories/section', () => {
    it('updates section content', async () => {
      await fs.writeFile(memoryPath, `# MEMORY.md

## Editable
- Old content
`);
      const app = await buildApp();
      const res = await app.request('/api/memories/section', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Editable', content: '- New content' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; result: { updated: boolean } };
      expect(json.ok).toBe(true);

      const content = await fs.readFile(memoryPath, 'utf-8');
      expect(content).toContain('New content');
      expect(content).not.toContain('Old content');
    });

    it('returns 404 when section not found', async () => {
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      const app = await buildApp();
      const res = await app.request('/api/memories/section', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Missing', content: 'stuff' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('file watcher broadcasts', () => {
    it('includes agentId when MEMORY.md changes on disk', async () => {
      await fs.writeFile(memoryPath, '# MEMORY.md\n');
      const { startFileWatcher, stopFileWatcher } = await loadFileWatcher();

      startFileWatcher();
      await fs.writeFile(memoryPath, '# MEMORY.md\n\n## Facts\n- Updated\n');

      await waitForBroadcast(([event, payload]) => (
        event === 'memory.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { file?: string; agentId?: string }).file === 'MEMORY.md'
        && (payload as { file?: string; agentId?: string }).agentId === 'main'
      ));

      await waitForBroadcast(([event, payload]) => (
        event === 'file.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { path?: string; agentId?: string }).path === 'MEMORY.md'
        && (payload as { path?: string; agentId?: string }).agentId === 'main'
      ));

      stopFileWatcher();
    });

    it('includes agentId when daily memory files change on disk', async () => {
      const dailyPath = path.join(memoryDir, '2026-02-26.md');
      await fs.writeFile(dailyPath, '## Morning\n- First\n');
      const { startFileWatcher, stopFileWatcher } = await loadFileWatcher();

      startFileWatcher();
      await fs.writeFile(dailyPath, '## Morning\n- Updated\n');

      await waitForBroadcast(([event, payload]) => (
        event === 'memory.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { file?: string; agentId?: string }).file === '2026-02-26.md'
        && (payload as { file?: string; agentId?: string }).agentId === 'main'
      ));

      await waitForBroadcast(([event, payload]) => (
        event === 'file.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { path?: string; agentId?: string }).path === 'memory/2026-02-26.md'
        && (payload as { path?: string; agentId?: string }).agentId === 'main'
      ));

      stopFileWatcher();
    });

    it('includes scoped agentId when a non-main MEMORY.md changes on disk', async () => {
      const researchMemoryPath = path.join(researchWorkspace, 'MEMORY.md');
      await fs.writeFile(researchMemoryPath, '# MEMORY.md\n');
      const { startFileWatcher, stopFileWatcher } = await loadFileWatcher();

      startFileWatcher();
      await fs.writeFile(researchMemoryPath, '# MEMORY.md\n\n## Facts\n- Research update\n');

      await waitForBroadcast(([event, payload]) => (
        event === 'memory.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { file?: string; agentId?: string }).file === 'MEMORY.md'
        && (payload as { file?: string; agentId?: string }).agentId === 'research'
      ));

      await waitForBroadcast(([event, payload]) => (
        event === 'file.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { path?: string; agentId?: string }).path === 'MEMORY.md'
        && (payload as { path?: string; agentId?: string }).agentId === 'research'
      ));

      stopFileWatcher();
    });

    it('includes scoped agentId when a non-main daily memory file changes on disk', async () => {
      const researchMemoryDir = path.join(researchWorkspace, 'memory');
      const researchDailyPath = path.join(researchMemoryDir, '2026-02-26.md');
      await fs.mkdir(researchMemoryDir, { recursive: true });
      await fs.writeFile(researchDailyPath, '## Morning\n- First\n');
      const { startFileWatcher, stopFileWatcher } = await loadFileWatcher();

      startFileWatcher();
      await fs.writeFile(researchDailyPath, '## Morning\n- Updated\n');

      await waitForBroadcast(([event, payload]) => (
        event === 'memory.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { file?: string; agentId?: string }).file === '2026-02-26.md'
        && (payload as { file?: string; agentId?: string }).agentId === 'research'
      ));

      await waitForBroadcast(([event, payload]) => (
        event === 'file.changed'
        && payload !== null
        && typeof payload === 'object'
        && (payload as { path?: string; agentId?: string }).path === 'memory/2026-02-26.md'
        && (payload as { path?: string; agentId?: string }).agentId === 'research'
      ));

      stopFileWatcher();
    });
  });
});
