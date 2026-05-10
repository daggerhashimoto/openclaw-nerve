import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRootFromDirectory, resolveProjectRoot } from './project-root.js';

let tmpDir: string | undefined;
const originalCwd = process.cwd();
const originalProjectRoot = process.env.NERVE_PROJECT_ROOT;

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalProjectRoot === undefined) {
    delete process.env.NERVE_PROJECT_ROOT;
  } else {
    process.env.NERVE_PROJECT_ROOT = originalProjectRoot;
  }
  if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

describe('project root resolution', () => {
  it('finds the project root from the emitted nested server build path', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nerve-project-root-'));
    await fs.promises.writeFile(path.join(tmpDir, 'package.json'), '{"name":"openclaw-nerve"}');
    const emittedServerDir = path.join(tmpDir, 'server-dist', 'server', 'lib');
    await fs.promises.mkdir(emittedServerDir, { recursive: true });

    expect(findProjectRootFromDirectory(emittedServerDir)).toBe(tmpDir);
  });

  it('uses a valid NERVE_PROJECT_ROOT override', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nerve-project-root-'));
    await fs.promises.writeFile(path.join(tmpDir, 'package.json'), '{"name":"openclaw-nerve"}');
    process.env.NERVE_PROJECT_ROOT = tmpDir;

    expect(resolveProjectRoot()).toBe(tmpDir);
  });

  it('throws a clear error for an invalid NERVE_PROJECT_ROOT override', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nerve-project-root-'));
    const invalidRoot = path.join(tmpDir, 'missing-package');
    await fs.promises.mkdir(invalidRoot);
    process.env.NERVE_PROJECT_ROOT = invalidRoot;

    expect(() => resolveProjectRoot()).toThrow(`NERVE_PROJECT_ROOT does not contain package.json: ${invalidRoot}`);
  });

  it('falls back to the current working directory project root', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nerve-project-root-'));
    await fs.promises.writeFile(path.join(tmpDir, 'package.json'), '{"name":"openclaw-nerve"}');
    const nestedDir = path.join(tmpDir, 'nested', 'server');
    await fs.promises.mkdir(nestedDir, { recursive: true });
    delete process.env.NERVE_PROJECT_ROOT;
    process.chdir(nestedDir);

    await expect(fs.promises.realpath(resolveProjectRoot())).resolves.toBe(await fs.promises.realpath(tmpDir));
  });
});
