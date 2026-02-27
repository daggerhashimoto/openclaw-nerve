/** Tests for the file browser routes (tree, read, write, raw). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('file-browser routes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fbrowser-test-'));
    // Create a MEMORY.md in the tmpDir so getWorkspaceRoot returns tmpDir
    await fs.writeFile(path.join(tmpDir, 'MEMORY.md'), '# Memories\n');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function buildApp() {
    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false, port: 3000, host: '127.0.0.1', sslPort: 3443,
        memoryPath: path.join(tmpDir, 'MEMORY.md'),
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));

    const mod = await import('./file-browser.js');
    const app = new Hono();
    app.route('/', mod.default);
    return app;
  }

  describe('GET /api/files/tree', () => {
    it('lists directory entries at root', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.md'), '# Test');
      await fs.mkdir(path.join(tmpDir, 'subdir'));

      const app = await buildApp();
      const res = await app.request('/api/files/tree');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; entries: Array<{ name: string; type: string }> };
      expect(json.ok).toBe(true);
      expect(json.entries.length).toBeGreaterThanOrEqual(1);

      const names = json.entries.map(e => e.name);
      expect(names).toContain('test.md');
      expect(names).toContain('subdir');
    });

    it('returns 400 for non-existent subdirectory', async () => {
      // resolveWorkspacePath returns null for non-existent paths, so route returns 400
      const app = await buildApp();
      const res = await app.request('/api/files/tree?path=nonexistent');
      expect(res.status).toBe(400);
    });

    it('rejects path traversal attempts', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/tree?path=../../etc');
      expect(res.status).toBe(400);
    });

    it('excludes node_modules and .git', async () => {
      await fs.mkdir(path.join(tmpDir, 'node_modules'));
      await fs.mkdir(path.join(tmpDir, '.git'));
      await fs.writeFile(path.join(tmpDir, 'visible.md'), 'hi');

      const app = await buildApp();
      const res = await app.request('/api/files/tree');
      const json = (await res.json()) as { ok: boolean; entries: Array<{ name: string }> };
      const names = json.entries.map(e => e.name);
      expect(names).not.toContain('node_modules');
      expect(names).not.toContain('.git');
    });
  });

  describe('GET /api/files/read', () => {
    it('returns 400 when path is missing', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/read');
      expect(res.status).toBe(400);
    });

    it('reads a text file', async () => {
      await fs.writeFile(path.join(tmpDir, 'readme.md'), '# Hello World');
      const app = await buildApp();
      const res = await app.request('/api/files/read?path=readme.md');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; content: string };
      expect(json.ok).toBe(true);
      expect(json.content).toBe('# Hello World');
    });

    it('returns 403 for non-existent file (resolveWorkspacePath fails)', async () => {
      // resolveWorkspacePath returns null for non-existent files (unless allowNonExistent)
      // so the route returns 403 "Invalid or excluded path", not 404
      const app = await buildApp();
      const res = await app.request('/api/files/read?path=nope.md');
      expect(res.status).toBe(403);
    });

    it('returns 415 for binary files', async () => {
      await fs.writeFile(path.join(tmpDir, 'image.png'), Buffer.from([0x89, 0x50]));
      const app = await buildApp();
      const res = await app.request('/api/files/read?path=image.png');
      expect(res.status).toBe(415);
    });

    it('rejects path traversal', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/read?path=../../../etc/passwd');
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/files/write', () => {
    it('writes a new file', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'new-file.md', content: '# New File' }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; mtime: number };
      expect(json.ok).toBe(true);
      expect(json.mtime).toBeGreaterThan(0);

      // Verify file was written
      const content = await fs.readFile(path.join(tmpDir, 'new-file.md'), 'utf-8');
      expect(content).toBe('# New File');
    });

    it('returns 400 when path is missing', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'hello' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when content is missing', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.md' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects path traversal on write', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../etc/passwd', content: 'hacked' }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects binary file writes', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'image.png', content: 'not really an image' }),
      });
      expect(res.status).toBe(415);
    });

    it('detects conflict via expectedMtime', async () => {
      const filePath = path.join(tmpDir, 'conflict.md');
      await fs.writeFile(filePath, 'original');

      const app = await buildApp();
      // Write with a stale mtime
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'conflict.md', content: 'updated', expectedMtime: 1 }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/files/rename', () => {
    it('renames a file in place', async () => {
      await fs.writeFile(path.join(tmpDir, 'old.md'), 'hello');
      const app = await buildApp();

      const res = await app.request('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'old.md', newName: 'new.md' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; from: string; to: string };
      expect(json.ok).toBe(true);
      expect(json.from).toBe('old.md');
      expect(json.to).toBe('new.md');

      await expect(fs.readFile(path.join(tmpDir, 'new.md'), 'utf-8')).resolves.toBe('hello');
    });

    it('returns 409 on name conflict', async () => {
      await fs.writeFile(path.join(tmpDir, 'a.md'), 'a');
      await fs.writeFile(path.join(tmpDir, 'b.md'), 'b');
      const app = await buildApp();

      const res = await app.request('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'a.md', newName: 'b.md' }),
      });

      expect(res.status).toBe(409);
    });

    it('blocks renaming a root file to reserved .trash', async () => {
      await fs.writeFile(path.join(tmpDir, 'note.md'), 'x');
      const app = await buildApp();

      const res = await app.request('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'note.md', newName: '.trash' }),
      });

      expect(res.status).toBe(422);
    });

    it('rejects rename with control characters in name', async () => {
      await fs.writeFile(path.join(tmpDir, 'note.md'), 'x');
      const app = await buildApp();

      const res = await app.request('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'note.md', newName: 'bad\u0000name.md' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/files/move', () => {
    it('moves a file into a directory', async () => {
      await fs.mkdir(path.join(tmpDir, 'docs'));
      await fs.writeFile(path.join(tmpDir, 'note.md'), 'hello');
      const app = await buildApp();

      const res = await app.request('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: 'note.md', targetDirPath: 'docs' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; from: string; to: string };
      expect(json.ok).toBe(true);
      expect(json.to).toBe('docs/note.md');

      await expect(fs.readFile(path.join(tmpDir, 'docs', 'note.md'), 'utf-8')).resolves.toBe('hello');
    });

    it('blocks moving a folder into its own descendant', async () => {
      await fs.mkdir(path.join(tmpDir, 'a'));
      await fs.mkdir(path.join(tmpDir, 'a', 'b'), { recursive: true });
      const app = await buildApp();

      const res = await app.request('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: 'a', targetDirPath: 'a/b' }),
      });

      expect(res.status).toBe(422);
    });

    it('blocks moving directly into .trash via generic move API', async () => {
      await fs.mkdir(path.join(tmpDir, '.trash'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'note.md'), 'x');
      const app = await buildApp();

      const res = await app.request('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: 'note.md', targetDirPath: '.trash' }),
      });

      expect(res.status).toBe(422);
      const json = (await res.json()) as { code?: string };
      expect(json.code).toBe('use_trash_api');
    });
  });

  describe('POST /api/files/trash + /api/files/restore', () => {
    it('moves file to .trash and restores it back', async () => {
      await fs.mkdir(path.join(tmpDir, 'docs'));
      await fs.writeFile(path.join(tmpDir, 'docs', 'spec.md'), 'spec');
      const app = await buildApp();

      const trashRes = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'docs/spec.md' }),
      });

      expect(trashRes.status).toBe(200);
      const trashJson = (await trashRes.json()) as { ok: boolean; from: string; to: string };
      expect(trashJson.ok).toBe(true);
      expect(trashJson.from).toBe('docs/spec.md');
      expect(trashJson.to.startsWith('.trash/')).toBe(true);

      // .trash should be visible, but internal index should remain hidden
      const treeRes = await app.request('/api/files/tree?path=.trash&depth=1');
      expect(treeRes.status).toBe(200);
      const treeJson = (await treeRes.json()) as { ok: boolean; entries: Array<{ name: string }> };
      const names = treeJson.entries.map((e) => e.name);
      expect(names).not.toContain('.index.json');

      const restoreRes = await app.request('/api/files/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trashJson.to }),
      });

      expect(restoreRes.status).toBe(200);
      const restoreJson = (await restoreRes.json()) as { ok: boolean; to: string };
      expect(restoreJson.ok).toBe(true);
      expect(restoreJson.to).toBe('docs/spec.md');

      await expect(fs.readFile(path.join(tmpDir, 'docs', 'spec.md'), 'utf-8')).resolves.toBe('spec');
    });

    it('restore returns 409 when original path is occupied', async () => {
      await fs.mkdir(path.join(tmpDir, 'docs'));
      await fs.writeFile(path.join(tmpDir, 'docs', 'spec.md'), 'original');
      const app = await buildApp();

      const trashRes = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'docs/spec.md' }),
      });
      const trashJson = (await trashRes.json()) as { to: string };

      // Re-create original path to force conflict
      await fs.writeFile(path.join(tmpDir, 'docs', 'spec.md'), 'replacement');

      const restoreRes = await app.request('/api/files/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trashJson.to }),
      });

      expect(restoreRes.status).toBe(409);
    });
  });

  describe('GET /api/files/raw', () => {
    it('returns 400 when path is missing', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/raw');
      expect(res.status).toBe(400);
    });

    it('returns 415 for unsupported file types', async () => {
      await fs.writeFile(path.join(tmpDir, 'file.txt'), 'hello');
      const app = await buildApp();
      const res = await app.request('/api/files/raw?path=file.txt');
      expect(res.status).toBe(415);
    });

    it('serves image files with correct MIME type', async () => {
      await fs.writeFile(path.join(tmpDir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const app = await buildApp();
      const res = await app.request('/api/files/raw?path=photo.png');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });
  });
});
