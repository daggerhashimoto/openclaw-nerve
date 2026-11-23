/**
 * Keep node-pty's `spawn-helper` executable.
 *
 * node-pty runs every PTY on macOS through a small `spawn-helper` binary next to
 * its native module. The node-pty 1.1.0 package on npm ships that binary
 * without the execute bit, and npm keeps the mode from the package, so on a
 * fresh install every spawn fails with `posix_spawnp failed`. This sets the bit
 * before Nerve spawns anything.
 * @module
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export type SpawnHelperStatus = 'not-needed' | 'ok' | 'fixed' | 'missing' | 'failed';

export interface SpawnHelperOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  /** The node-pty package folder. Defaults to the installed one. */
  packageDir?: string | null;
}

/** The installed node-pty package folder, or null when it cannot be found. */
export function resolveNodePtyDir(): string | null {
  try {
    return path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  } catch {
    return null;
  }
}

/**
 * Make sure the `spawn-helper` node-pty will use is executable, adding the
 * execute bits when they are missing. Never throws.
 */
export function ensureSpawnHelperExecutable(options: SpawnHelperOptions = {}): SpawnHelperStatus {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') return 'not-needed';

  const packageDir = options.packageDir === undefined ? resolveNodePtyDir() : options.packageDir;
  if (!packageDir) return 'missing';

  // The same folders, in the same order, that node-pty loads pty.node from
  // (lib/utils.js loadNativeModule); spawn-helper sits beside it.
  const arch = options.arch ?? process.arch;
  const nativeDir = ['build/Release', 'build/Debug', `prebuilds/${platform}-${arch}`]
    .map((dir) => path.join(packageDir, dir))
    .find((dir) => fs.existsSync(path.join(dir, 'pty.node')));
  if (!nativeDir) return 'missing';

  const helper = path.join(nativeDir, 'spawn-helper');
  let mode: number;
  try {
    mode = fs.statSync(helper).mode;
  } catch {
    return 'missing';
  }
  if ((mode & 0o111) === 0o111) return 'ok';

  try {
    fs.chmodSync(helper, (mode & 0o7777) | 0o111);
    return 'fixed';
  } catch (err) {
    console.warn(
      `[pty] node-pty's spawn-helper is not executable and could not be fixed (${(err as Error).message}). ` +
      `Run: chmod +x "${helper}"`,
    );
    return 'failed';
  }
}
