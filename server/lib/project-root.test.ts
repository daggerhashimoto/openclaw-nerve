import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findProjectRootFromDirectory } from './project-root.js';

let tmpDir: string | undefined;

afterEach(async () => {
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
});
