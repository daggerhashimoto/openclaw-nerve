import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function importHelpers() {
  vi.resetModules();
  return import('./upload-reference.js');
}

const originalHome = process.env.HOME;
const originalFileBrowserRoot = process.env.FILE_BROWSER_ROOT;
const originalUploadStagingTempDir = process.env.NERVE_UPLOAD_STAGING_TEMP_DIR;
const tempDirs = new Set<string>();

async function makeHomeWorkspace(): Promise<{ homeDir: string; workspaceRoot: string }> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nerve-upload-reference-lib-home-'));
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

describe('upload-reference helpers', () => {
  it('imports external uploads into canonical staged workspace references', async () => {
    const { workspaceRoot } = await makeHomeWorkspace();
    const { importExternalUploadToCanonicalReference } = await importHelpers();

    const result = await importExternalUploadToCanonicalReference({
      originalName: 'proof.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('hello import'),
    });

    expect(result.kind).toBe('imported_workspace_reference');
    expect(result.canonicalPath).toMatch(/^\.temp\/nerve-uploads\/\d{4}\/\d{2}\/\d{2}\/proof-[a-f0-9]{8}\.txt$/);
    expect(result.absolutePath).toBe(path.join(workspaceRoot, result.canonicalPath));
    expect(result.mimeType).toBe('text/plain');
    expect(result.sizeBytes).toBe(12);
    expect(result.originalName).toBe('proof.txt');
    await expect(fs.readFile(result.absolutePath, 'utf8')).resolves.toBe('hello import');
  });

  it('rejects imported staging output when the configured staging root escapes the workspace', async () => {
    const { homeDir } = await makeHomeWorkspace();
    const outsideStageRoot = path.join(homeDir, 'outside-stage');
    process.env.NERVE_UPLOAD_STAGING_TEMP_DIR = outsideStageRoot;
    const { importExternalUploadToCanonicalReference } = await importHelpers();

    await expect(importExternalUploadToCanonicalReference({
      originalName: 'proof.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('hello import'),
    })).rejects.toThrow('Resolved attachment path is outside the workspace root.');

    await expect(fs.stat(outsideStageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
