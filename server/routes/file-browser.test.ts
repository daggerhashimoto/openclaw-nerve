/** Tests for the file browser routes (tree, read, write, raw). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('file-browser routes', () => {
  let homeDir: string;
  let tmpDir: string;
  let researchWorkspace: string;
  let remoteHomeDir: string;
  let remoteWorkspace: string;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fbrowser-test-'));
    tmpDir = path.join(homeDir, '.openclaw', 'workspace');
    researchWorkspace = path.join(homeDir, '.openclaw', 'workspace-research');
    remoteHomeDir = path.join(homeDir, 'remote-nonexistent');
    remoteWorkspace = path.join(remoteHomeDir, '.openclaw', 'workspace');
    await fs.mkdir(tmpDir, { recursive: true });
    // Create a MEMORY.md in the tmpDir so getWorkspaceRoot returns tmpDir
    await fs.writeFile(path.join(tmpDir, 'MEMORY.md'), '# Memories\n');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function buildApp(opts?: {
    fileBrowserRoot?: string;
    remote?: boolean;
    gatewayFilesListResult?: Array<{ name: string; missing?: boolean; size?: number; updatedAtMs?: number }>;
  }) {
    vi.resetModules();
    vi.doUnmock('../lib/gateway-rpc.js');

    const useRemote = opts?.remote ?? false;
    const configuredHomeDir = useRemote ? remoteHomeDir : homeDir;
    const configuredWorkspace = useRemote ? remoteWorkspace : tmpDir;

    vi.doMock('../lib/config.js', () => ({
      config: {
        auth: false,
        port: 3000,
        host: '127.0.0.1',
        sslPort: 3443,
        home: configuredHomeDir,
        memoryPath: path.join(configuredWorkspace, 'MEMORY.md'),
        memoryDir: path.join(configuredWorkspace, 'memory'),
        fileBrowserRoot: opts?.fileBrowserRoot ?? '',
        workspaceRemote: false,
      },
      SESSION_COOKIE_NAME: 'nerve_session_3000',
    }));

    if (useRemote) {
      vi.doMock('../lib/gateway-rpc.js', () => ({
        gatewayFilesList: vi.fn().mockResolvedValue(opts?.gatewayFilesListResult ?? []),
        gatewayFilesGet: vi.fn(),
        gatewayFilesSet: vi.fn(),
      }));

      const detectMod = await import('../lib/workspace-detect.js');
      detectMod.clearWorkspaceDetectCache();
    }

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

    it('hides hidden workspace entries by default', async () => {
      await fs.writeFile(path.join(tmpDir, '.hidden.md'), 'secret');
      await fs.writeFile(path.join(tmpDir, 'visible.md'), 'hello');

      const app = await buildApp();
      const res = await app.request('/api/files/tree');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; entries: Array<{ name: string }> };
      const names = json.entries.map(e => e.name);

      expect(names).toContain('visible.md');
      expect(names).not.toContain('.hidden.md');
    });

    it('includes hidden workspace entries when showHidden=true', async () => {
      await fs.writeFile(path.join(tmpDir, '.hidden.md'), 'secret');
      await fs.mkdir(path.join(tmpDir, '.plans'));

      const app = await buildApp();
      const res = await app.request('/api/files/tree?showHidden=true');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; entries: Array<{ name: string }> };
      const names = json.entries.map(e => e.name);

      expect(names).toContain('.hidden.md');
      expect(names).toContain('.plans');
    });

    it('includes hidden workspace entries when showHidden=true via remote gateway fallback', async () => {
      const app = await buildApp({
        remote: true,
        gatewayFilesListResult: [
          { name: '.hidden.md', missing: false, size: 6, updatedAtMs: 1000 },
          { name: '.plans', missing: false, size: 0, updatedAtMs: 1001 },
          { name: 'visible.md', missing: false, size: 5, updatedAtMs: 1002 },
        ],
      });

      const res = await app.request('/api/files/tree?showHidden=true');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; entries: Array<{ name: string }>; remoteWorkspace?: boolean };
      const names = json.entries.map((e) => e.name);

      expect(json.ok).toBe(true);
      expect(json.remoteWorkspace).toBe(true);
      expect(names).toContain('.hidden.md');
      expect(names).toContain('.plans');
      expect(names).toContain('visible.md');
    });
  });

  describe('GET /api/files/resolve', () => {
    it('classifies workspace files as openable targets', async () => {
      await fs.writeFile(path.join(tmpDir, 'docs-note.md'), '# hi');
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=docs-note.md');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'docs-note.md', type: 'file', binary: false });
    });

    it('classifies workspace directories as revealable targets', async () => {
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=docs');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'docs', type: 'directory', binary: false });
    });

    it('resolves current-document-relative file links safely within the workspace', async () => {
      await fs.mkdir(path.join(tmpDir, 'docs', 'guide'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'docs', 'guide', 'advanced.md'), '# Advanced');
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=advanced.md&relativeTo=docs/guide/index.md');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'docs/guide/advanced.md', type: 'file', binary: false });
    });

    it('supports workspace-root links from markdown docs via a leading slash', async () => {
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'docs', 'todo.md'), '# Todo');
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=/docs/todo.md&relativeTo=notes/index.md');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'docs/todo.md', type: 'file', binary: false });
    });

    it('resolves workspace-root-document relative links even when relativeTo is slash-prefixed', async () => {
      await fs.mkdir(path.join(tmpDir, 'projects', 'demo'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'projects', 'demo', 'notes.md'), '# Notes');
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=./projects/demo/notes.md&relativeTo=/README.md');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'projects/demo/notes.md', type: 'file', binary: false });
    });

    it('returns 404 for safe missing targets inside the workspace root', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/resolve?path=missing-note.md');
      expect(res.status).toBe(404);
    });

    it('accepts /workspace-prefixed paths by normalizing to workspace-relative', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'main.ts'), 'export {};');
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=%2Fworkspace%2Fsrc%2Fmain.ts');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'src/main.ts', type: 'file', binary: false });
    });

    it('keeps /workspace-prefixed links rooted even when relativeTo is provided', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.mkdir(path.join(tmpDir, 'notes'));
      await fs.writeFile(path.join(tmpDir, 'src', 'main.ts'), 'export {};');
      const app = await buildApp();

      const res = await app.request('/api/files/resolve?path=%2Fworkspace%2Fsrc%2Fmain.ts&relativeTo=notes/index.md');
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'src/main.ts', type: 'file', binary: false });
    });

    it('accepts absolute host paths rooted at the real workspace by normalizing them to workspace-relative', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'main.ts'), 'export {};');
      const app = await buildApp();
      const absoluteTarget = path.join(tmpDir, 'src', 'main.ts').split(path.sep).join('/');

      const res = await app.request(`/api/files/resolve?path=${encodeURIComponent(absoluteTarget)}`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'src/main.ts', type: 'file', binary: false });
    });

    it('accepts symlink-expanded absolute host paths for the same workspace root', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'main.ts'), 'export {};');
      const app = await buildApp();
      const realTarget = (await fs.realpath(path.join(tmpDir, 'src', 'main.ts'))).split(path.sep).join('/');

      const res = await app.request(`/api/files/resolve?path=${encodeURIComponent(realTarget)}`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'src/main.ts', type: 'file', binary: false });
    });

    it('keeps absolute host workspace paths rooted even when relativeTo is provided', async () => {
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.mkdir(path.join(tmpDir, 'notes'));
      await fs.writeFile(path.join(tmpDir, 'src', 'main.ts'), 'export {};');
      const app = await buildApp();
      const absoluteTarget = path.join(tmpDir, 'src', 'main.ts').split(path.sep).join('/');

      const res = await app.request(`/api/files/resolve?path=${encodeURIComponent(absoluteTarget)}&relativeTo=notes/index.md`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; path: string; type: string; binary: boolean };
      expect(json).toEqual({ ok: true, path: 'src/main.ts', type: 'file', binary: false });
    });

    it('treats the absolute workspace root itself as a non-openable root target', async () => {
      const app = await buildApp();
      const absoluteRoot = tmpDir.split(path.sep).join('/');

      const res = await app.request(`/api/files/resolve?path=${encodeURIComponent(absoluteRoot)}`);
      expect(res.status).toBe(404);
    });

    it('returns 403 for invalid or excluded targets', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/resolve?path=../../etc');
      expect(res.status).toBe(403);
    });

    it('returns 403 when a current-document-relative link escapes the workspace', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/resolve?path=../../../etc/passwd&relativeTo=docs/guide/index.md');
      expect(res.status).toBe(403);
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

    it('uses normal trash behavior when FILE_BROWSER_ROOT is not set', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.txt'), 'test content');

      const app = await buildApp();
      const res = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.txt' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; from: string; to: string; undoTtlMs?: number };
      expect(json.ok).toBe(true);
      expect(json.from).toBe('test.txt');
      expect(json.to.startsWith('.trash/')).toBe(true);
      expect(json.undoTtlMs).toBeGreaterThan(0);

      // Verify file is moved to trash, not deleted
      const originalPath = path.join(tmpDir, 'test.txt');
      await expect(fs.readFile(originalPath, 'utf-8')).rejects.toThrow();

      const trashPath = path.join(tmpDir, json.to);
      await expect(fs.readFile(trashPath, 'utf-8')).resolves.toBe('test content');
    });
  });

  describe('agent-scoped workspaces', () => {
    it('lists only files from the requested agent workspace', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'main-only.md'), 'main');
      await fs.writeFile(path.join(researchWorkspace, 'research-only.md'), 'research');

      const app = await buildApp();
      const res = await app.request('/api/files/tree?agentId=research');

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; entries: Array<{ name: string }> };
      const names = json.entries.map((entry) => entry.name);
      expect(names).toContain('research-only.md');
      expect(names).not.toContain('main-only.md');
    });

    it('reads files from the requested agent workspace', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'notes.md'), 'main notes');
      await fs.writeFile(path.join(researchWorkspace, 'notes.md'), 'research notes');

      const app = await buildApp();
      const res = await app.request('/api/files/read?agentId=research&path=notes.md');

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; content: string };
      expect(json.ok).toBe(true);
      expect(json.content).toBe('research notes');
    });

    it('serves raw assets from the requested agent workspace', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      const mainBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
      const researchBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
      await fs.writeFile(path.join(tmpDir, 'photo.png'), mainBytes);
      await fs.writeFile(path.join(researchWorkspace, 'photo.png'), researchBytes);

      const app = await buildApp();
      const res = await app.request('/api/files/raw?agentId=research&path=photo.png');

      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(researchBytes);
    });

    it('writes files into the requested agent workspace', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'notes.md'), 'main notes');

      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', path: 'notes.md', content: 'research notes' }),
      });

      expect(res.status).toBe(200);
      await expect(fs.readFile(path.join(researchWorkspace, 'notes.md'), 'utf-8')).resolves.toBe('research notes');
      await expect(fs.readFile(path.join(tmpDir, 'notes.md'), 'utf-8')).resolves.toBe('main notes');
    });

    it('bootstraps the first write into a fresh agent workspace', async () => {
      const app = await buildApp();
      const res = await app.request('/api/files/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', path: 'notes.md', content: 'research notes' }),
      });

      expect(res.status).toBe(200);
      await expect(fs.readFile(path.join(researchWorkspace, 'notes.md'), 'utf-8')).resolves.toBe('research notes');
      await expect(fs.access(path.join(tmpDir, 'notes.md'))).rejects.toThrow();
    });

    it('keeps rename, move, trash, and restore scoped to the requested agent workspace', async () => {
      await fs.mkdir(researchWorkspace, { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'archive'), { recursive: true });
      await fs.mkdir(path.join(researchWorkspace, 'archive'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'draft.md'), 'main draft');
      await fs.writeFile(path.join(researchWorkspace, 'draft.md'), 'research draft');

      const app = await buildApp();

      const renameRes = await app.request('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', path: 'draft.md', newName: 'renamed.md' }),
      });
      expect(renameRes.status).toBe(200);
      await expect(fs.readFile(path.join(researchWorkspace, 'renamed.md'), 'utf-8')).resolves.toBe('research draft');
      await expect(fs.readFile(path.join(tmpDir, 'draft.md'), 'utf-8')).resolves.toBe('main draft');

      const moveRes = await app.request('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', sourcePath: 'renamed.md', targetDirPath: 'archive' }),
      });
      expect(moveRes.status).toBe(200);
      await expect(fs.readFile(path.join(researchWorkspace, 'archive', 'renamed.md'), 'utf-8')).resolves.toBe('research draft');
      await expect(fs.access(path.join(tmpDir, 'archive', 'renamed.md'))).rejects.toThrow();

      const trashRes = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', path: 'archive/renamed.md' }),
      });
      expect(trashRes.status).toBe(200);
      const trashJson = (await trashRes.json()) as { ok: boolean; to: string };
      expect(trashJson.ok).toBe(true);
      expect(trashJson.to.startsWith('.trash/')).toBe(true);
      await expect(fs.readFile(path.join(tmpDir, 'draft.md'), 'utf-8')).resolves.toBe('main draft');

      const restoreRes = await app.request('/api/files/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'research', path: trashJson.to }),
      });
      expect(restoreRes.status).toBe(200);
      await expect(fs.readFile(path.join(researchWorkspace, 'archive', 'renamed.md'), 'utf-8')).resolves.toBe('research draft');
      await expect(fs.readFile(path.join(tmpDir, 'draft.md'), 'utf-8')).resolves.toBe('main draft');
    });
  });

  describe('workspace info in tree response', () => {
    it('includes workspace info when FILE_BROWSER_ROOT is not set', async () => {
      await fs.writeFile(path.join(tmpDir, 'test.md'), '# Test');

      const app = await buildApp();
      const res = await app.request('/api/files/tree');
      expect(res.status).toBe(200);

      const json = (await res.json()) as {
        ok: boolean;
        entries: Array<{ name: string; type: string }>;
        workspaceInfo?: { isCustomWorkspace: boolean; rootPath: string };
      };

      expect(json.ok).toBe(true);
      expect(json.workspaceInfo).toBeDefined();
      expect(json.workspaceInfo!.isCustomWorkspace).toBe(false);
      expect(json.workspaceInfo!.rootPath).toBe(tmpDir);
    });

    it('includes workspace info when FILE_BROWSER_ROOT is set', async () => {
      const customRoot = path.join(tmpDir, 'custom-workspace');
      await fs.mkdir(customRoot);
      await fs.writeFile(path.join(customRoot, 'test.md'), '# Test');

      const app = await buildApp({ fileBrowserRoot: customRoot });
      const res = await app.request('/api/files/tree');
      expect(res.status).toBe(200);
      
      const json = (await res.json()) as { 
        ok: boolean; 
        entries: Array<{ name: string; type: string }>;
        workspaceInfo?: { isCustomWorkspace: boolean; rootPath: string };
      };
      
      expect(json.ok).toBe(true);
      expect(json.workspaceInfo).toBeDefined();
      expect(json.workspaceInfo).toEqual({
        isCustomWorkspace: true,
        rootPath: customRoot,
      });
    });
  });

  describe('POST /api/files/trash with FILE_BROWSER_ROOT', () => {
    it('permanently deletes when FILE_BROWSER_ROOT is set', async () => {
      const customRoot = path.join(tmpDir, 'custom-workspace');
      await fs.mkdir(customRoot);
      await fs.writeFile(path.join(customRoot, 'test.txt'), 'test content');

      const app = await buildApp({ fileBrowserRoot: customRoot });
      const res = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test.txt' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; from: string; to: string; undoTtlMs?: number };
      expect(json.ok).toBe(true);
      expect(json.from).toBe('test.txt');
      expect(json.to).toBe('');
      expect(json.undoTtlMs).toBeUndefined();

      // Verify file was actually deleted from filesystem
      const originalPath = path.join(customRoot, 'test.txt');
      await expect(fs.readFile(originalPath, 'utf-8')).rejects.toThrow();
    });

    it('permanently deletes directories when FILE_BROWSER_ROOT is set', async () => {
      const customRoot = path.join(tmpDir, 'custom-workspace');
      await fs.mkdir(customRoot);
      const testDir = path.join(customRoot, 'test-dir');
      await fs.mkdir(testDir);
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content');

      const app = await buildApp({ fileBrowserRoot: customRoot });
      const res = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'test-dir' }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; from: string; to: string; undoTtlMs?: number };
      expect(json.ok).toBe(true);
      expect(json.from).toBe('test-dir');
      expect(json.to).toBe('');
      expect(json.undoTtlMs).toBeUndefined();

      // Verify directory was actually deleted from filesystem
      const originalDir = path.join(customRoot, 'test-dir');
      await expect(fs.access(originalDir)).rejects.toThrow();
    });

    it('prevents deletion of workspace root with "." path', async () => {
      const customRoot = path.join(tmpDir, 'custom-workspace');
      await fs.mkdir(customRoot);

      const app = await buildApp({ fileBrowserRoot: customRoot });
      const res = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Deleting workspace root is not allowed');
    });

    it('prevents deletion of workspace root with "./" path', async () => {
      const customRoot = path.join(tmpDir, 'custom-workspace');
      await fs.mkdir(customRoot);

      const app = await buildApp({ fileBrowserRoot: customRoot });
      const res = await app.request('/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: './' }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { ok: boolean; error: string };
      expect(json.ok).toBe(false);
      expect(json.error).toBe('Deleting workspace root is not allowed');
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
