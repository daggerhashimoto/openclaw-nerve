/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function importRoute() {
  vi.resetModules();
  return import('./upload-reference.js');
}

const originalHome = process.env.HOME;
const originalFileBrowserRoot = process.env.FILE_BROWSER_ROOT;
const originalUploadStagingTempDir = process.env.NERVE_UPLOAD_STAGING_TEMP_DIR;
const tempDirs = new Set<string>();

async function makeHomeWorkspace(): Promise<{ homeDir: string; workspaceRoot: string }> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nerve-upload-reference-home-'));
  tempDirs.add(homeDir);
  const workspaceRoot = path.join(homeDir, '.openclaw', 'workspace');
  await fs.mkdir(workspaceRoot, { recursive: true });
  process.env.HOME = homeDir;
  delete process.env.FILE_BROWSER_ROOT;
  delete process.env.NERVE_UPLOAD_STAGING_TEMP_DIR;
  return { homeDir, workspaceRoot };
}

afterEach(async () => {
  if (originalHome == null) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  if (originalFileBrowserRoot == null) {
    delete process.env.FILE_BROWSER_ROOT;
  } else {
    process.env.FILE_BROWSER_ROOT = originalFileBrowserRoot;
  }

  if (originalUploadStagingTempDir == null) {
    delete process.env.NERVE_UPLOAD_STAGING_TEMP_DIR;
  } else {
    process.env.NERVE_UPLOAD_STAGING_TEMP_DIR = originalUploadStagingTempDir;
  }

  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
    tempDirs.delete(dir);
  }
});

describe('POST /api/upload-reference/resolve', () => {
  it('returns a canonical direct workspace reference for a validated workspace file', async () => {
    const { workspaceRoot } = await makeHomeWorkspace();
    const targetPath = path.join(workspaceRoot, 'docs', 'note.md');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, '# hi\n', 'utf8');

    const { default: app } = await importRoute();
    const res = await app.request('/api/upload-reference/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'docs/note.md' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean;
      items: Array<{
        kind: string;
        canonicalPath: string;
        absolutePath: string;
        mimeType: string;
        sizeBytes: number;
        originalName: string;
      }>;
    };

    expect(json.ok).toBe(true);
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toEqual(expect.objectContaining({
      kind: 'direct_workspace_reference',
      canonicalPath: 'docs/note.md',
      absolutePath: targetPath,
      mimeType: 'text/markdown',
      sizeBytes: 5,
      originalName: 'note.md',
    }));
  });

  it('imports multipart uploads into canonical workspace references', async () => {
    const { workspaceRoot } = await makeHomeWorkspace();
    const { default: app } = await importRoute();
    const form = new FormData();
    form.append('files', new File(['hello upload'], 'proof.txt', { type: 'text/plain' }));

    const res = await app.request('/api/upload-reference/resolve', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as {
      ok: boolean;
      items: Array<{
        kind: string;
        canonicalPath: string;
        absolutePath: string;
        mimeType: string;
        sizeBytes: number;
        originalName: string;
      }>;
    };

    expect(json.ok).toBe(true);
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toEqual(expect.objectContaining({
      kind: 'imported_workspace_reference',
      mimeType: 'text/plain',
      sizeBytes: 12,
      originalName: 'proof.txt',
    }));
    expect(json.items[0].canonicalPath).toMatch(/^\.temp\/nerve-uploads\/\d{4}\/\d{2}\/\d{2}\/proof-[a-f0-9]{8}\.txt$/);
    expect(json.items[0].absolutePath).toBe(path.join(workspaceRoot, json.items[0].canonicalPath));
    await expect(fs.readFile(json.items[0].absolutePath, 'utf8')).resolves.toBe('hello upload');
  });

  it('rejects symlink escapes that resolve outside the workspace root', async () => {
    const { homeDir, workspaceRoot } = await makeHomeWorkspace();
    const outsidePath = path.join(homeDir, 'outside.txt');
    const linkedPath = path.join(workspaceRoot, 'docs', 'linked.txt');
    await fs.mkdir(path.dirname(linkedPath), { recursive: true });
    await fs.writeFile(outsidePath, 'secret', 'utf8');
    await fs.symlink(outsidePath, linkedPath);

    const { default: app } = await importRoute();
    const res = await app.request('/api/upload-reference/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'docs/linked.txt' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid or excluded workspace path.',
    });
  });
});
