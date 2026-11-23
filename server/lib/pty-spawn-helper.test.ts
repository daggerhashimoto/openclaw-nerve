import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSpawnHelperExecutable, resolveNodePtyDir } from './pty-spawn-helper.js';

describe('ensureSpawnHelperExecutable', () => {
  let packageDir: string;

  /** Lay out a node-pty native folder: pty.node plus a spawn-helper with the given mode. */
  function nativeDir(dir: string, helperMode: number | null): string {
    const full = path.join(packageDir, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, 'pty.node'), '');
    if (helperMode !== null) {
      const helper = path.join(full, 'spawn-helper');
      fs.writeFileSync(helper, '');
      fs.chmodSync(helper, helperMode);
    }
    return path.join(full, 'spawn-helper');
  }

  const modeOf = (file: string) => fs.statSync(file).mode & 0o777;

  beforeEach(() => {
    packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-helper-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(packageDir, { recursive: true, force: true });
  });

  it('makes a prebuilt helper that npm installed without the execute bit executable', () => {
    const helper = nativeDir('prebuilds/darwin-arm64', 0o644);

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('fixed');
    expect(modeOf(helper)).toBe(0o755);
  });

  it('adds only the execute bits, keeping the rest of the mode', () => {
    const helper = nativeDir('prebuilds/darwin-arm64', 0o600);

    ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir });

    expect(modeOf(helper)).toBe(0o711);
  });

  it('leaves a helper that is already executable alone', () => {
    const helper = nativeDir('prebuilds/darwin-x64', 0o755);
    const chmod = vi.spyOn(fs, 'chmodSync');

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'x64', packageDir })).toBe('ok');
    expect(chmod).not.toHaveBeenCalled();
    expect(modeOf(helper)).toBe(0o755);
  });

  it('fixes every helper node-pty might load, since a stale build/Release falls through to the prebuild', () => {
    const built = nativeDir('build/Release', 0o644);
    const prebuilt = nativeDir('prebuilds/darwin-arm64', 0o644);

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('fixed');
    expect(modeOf(built)).toBe(0o755);
    expect(modeOf(prebuilt)).toBe(0o755);
  });

  it('still fixes the prebuild when build/Release has a pty.node but no helper', () => {
    nativeDir('build/Release', null);
    const prebuilt = nativeDir('prebuilds/darwin-arm64', 0o644);

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('fixed');
    expect(modeOf(prebuilt)).toBe(0o755);
  });

  it('checks the bundled layout under lib/ that node-pty also searches', () => {
    const bundled = nativeDir('lib/prebuilds/darwin-arm64', 0o644);

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('fixed');
    expect(modeOf(bundled)).toBe(0o755);
  });

  it('reports a failure when any helper cannot be fixed, even if another one was', () => {
    nativeDir('build/Release', 0o644);
    const prebuilt = nativeDir('prebuilds/darwin-arm64', 0o644);
    const realChmod = fs.chmodSync;
    vi.spyOn(fs, 'chmodSync').mockImplementation((file, mode) => {
      if (String(file) === prebuilt) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      realChmod(file, mode);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('failed');
  });

  it('uses the prebuild for the running architecture', () => {
    const x64 = nativeDir('prebuilds/darwin-x64', 0o644);
    const arm = nativeDir('prebuilds/darwin-arm64', 0o644);

    ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'x64', packageDir });

    expect(modeOf(x64)).toBe(0o755);
    expect(modeOf(arm)).toBe(0o644);
  });

  it('does nothing on Windows, which does not use spawn-helper', () => {
    const helper = nativeDir('prebuilds/win32-x64', 0o644);

    expect(ensureSpawnHelperExecutable({ platform: 'win32', arch: 'x64', packageDir })).toBe('not-needed');
    expect(modeOf(helper)).toBe(0o644);
  });

  it('reports a native folder with no helper as missing', () => {
    nativeDir('build/Release', null);

    expect(ensureSpawnHelperExecutable({ platform: 'linux', arch: 'x64', packageDir })).toBe('missing');
  });

  it('reports missing when node-pty has no native module for the platform', () => {
    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('missing');
  });

  it('reports a failure without throwing when the helper cannot be changed', () => {
    nativeDir('prebuilds/darwin-arm64', 0o644);
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(ensureSpawnHelperExecutable({ platform: 'darwin', arch: 'arm64', packageDir })).toBe('failed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('chmod +x'));
  });
});

describe('resolveNodePtyDir', () => {
  it('finds the installed node-pty package', () => {
    const dir = resolveNodePtyDir();

    expect(dir).not.toBeNull();
    const pkg = JSON.parse(fs.readFileSync(path.join(dir as string, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('node-pty');
  });
});
