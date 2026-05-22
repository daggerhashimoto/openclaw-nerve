// @vitest-environment node

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const STAMP_SCRIPT = path.resolve(import.meta.dirname, 'telemetry-stamp.mjs');

describe('telemetry-stamp.mjs', () => {
  let tempDir: string;
  let readOnlyDirs: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerve-telemetry-stamp-'));
    readOnlyDirs = [];
  });

  afterEach(() => {
    for (const dir of readOnlyDirs) {
      fs.chmodSync(dir, 0o700);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runStampInDir(dir: string, ...args: string[]): void {
    execFileSync(process.execPath, [STAMP_SCRIPT, ...args, '--dir', dir], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }

  function runStamp(...args: string[]): void {
    runStampInDir(tempDir, ...args);
  }

  function runStampResult(dir: string, ...args: string[]) {
    return spawnSync(process.execPath, [STAMP_SCRIPT, ...args, '--dir', dir], {
      encoding: 'utf8',
    });
  }

  function runStampWithDefaultDir(cwd: string, ...args: string[]) {
    execFileSync(process.execPath, [STAMP_SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }

  function readStampFromDir(dir: string, kind: 'install-method' | 'bootstrap'): Record<string, unknown> | undefined {
    const fileName = kind === 'install-method' ? 'install-method.json' : 'bootstrap.json';
    const filePath = path.join(dir, fileName);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return undefined;
    }
  }

  function readStamp(kind: 'install-method' | 'bootstrap'): Record<string, unknown> | undefined {
    return readStampFromDir(tempDir, kind);
  }

  function makeReadOnlyDir(name: string): string {
    const dir = path.join(tempDir, name);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o500);
    readOnlyDirs.push(dir);
    return dir;
  }

  it('defaults local telemetry stamps to a checkout-scoped .nerve directory', () => {
    const projectRoot = path.join(tempDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });

    runStampWithDefaultDir(projectRoot, 'bootstrap', 'fresh_install', '--source', 'setup');

    const stamp = readStampFromDir(path.join(projectRoot, '.nerve', 'telemetry'), 'bootstrap');
    expect(stamp?.kind).toBe('fresh_install');
    expect(stamp?.source).toBe('setup');
  });

  describe('install-method stamping', () => {
    it('stamps release install method', () => {
      runStamp('install-method', 'release', '--source', 'install.sh');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('release');
      expect(stamp?.source).toBe('install.sh');
    });

    it('stamps source install method for branch installs', () => {
      runStamp('install-method', 'source', '--source', 'install.sh');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('source');
      expect(stamp?.source).toBe('install.sh');
    });

    it('stamps unknown install method', () => {
      runStamp('install-method', 'unknown', '--source', 'runtime');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('unknown');
      expect(stamp?.source).toBe('runtime');
    });

    it('respects --if-missing flag for install-method', () => {
      runStamp('install-method', 'release', '--source', 'install.sh');
      const original = readStamp('install-method');

      runStamp('install-method', 'source', '--if-missing', '--source', 'setup');

      const current = readStamp('install-method');
      expect(current?.installMethod).toBe('release');
      expect(current?.stampedAt).toBe(original?.stampedAt);
    });

    it('overwrites stale install-method metadata when --if-missing is omitted', () => {
      runStamp('install-method', 'unknown', '--source', 'runtime');

      runStamp('install-method', 'source', '--source', 'setup');

      const current = readStamp('install-method');
      expect(current?.installMethod).toBe('source');
      expect(current?.source).toBe('setup');
    });

    it('warns and exits successfully when install-method metadata cannot be written', () => {
      const readOnlyDir = makeReadOnlyDir('readonly-install-method');

      const result = runStampResult(readOnlyDir, 'install-method', 'release', '--source', 'install.sh');

      expect(result.status).toBe(0);
      expect(readStampFromDir(readOnlyDir, 'install-method')).toBeUndefined();
      expect(result.stderr).toContain('Failed to write install-method.json');
    });
  });

  describe('bootstrap stamping', () => {
    it('stamps fresh_install bootstrap marker', () => {
      runStamp('bootstrap', 'fresh_install', '--source', 'install.sh');

      const stamp = readStamp('bootstrap');
      expect(stamp?.kind).toBe('fresh_install');
      expect(stamp?.source).toBe('install.sh');
    });

    it('stamps upgrade_legacy bootstrap marker', () => {
      runStamp('bootstrap', 'upgrade_legacy', '--source', 'runtime');

      const stamp = readStamp('bootstrap');
      expect(stamp?.kind).toBe('upgrade_legacy');
      expect(stamp?.source).toBe('runtime');
    });

    it('respects --if-missing flag for bootstrap', () => {
      runStamp('bootstrap', 'fresh_install', '--source', 'install.sh');
      const original = readStamp('bootstrap');

      runStamp('bootstrap', 'upgrade_legacy', '--if-missing', '--source', 'runtime');

      const current = readStamp('bootstrap');
      expect(current?.kind).toBe('fresh_install');
      expect(current?.stampedAt).toBe(original?.stampedAt);
    });

    it('overwrites stale bootstrap metadata when --if-missing is omitted', () => {
      runStamp('bootstrap', 'upgrade_legacy', '--source', 'runtime');

      runStamp('bootstrap', 'fresh_install', '--source', 'install.sh');

      const current = readStamp('bootstrap');
      expect(current?.kind).toBe('fresh_install');
      expect(current?.source).toBe('install.sh');
    });

    it('warns and exits successfully when bootstrap metadata cannot be written', () => {
      const readOnlyDir = makeReadOnlyDir('readonly-bootstrap');

      const result = runStampResult(readOnlyDir, 'bootstrap', 'fresh_install', '--source', 'install.sh');

      expect(result.status).toBe(0);
      expect(readStampFromDir(readOnlyDir, 'bootstrap')).toBeUndefined();
      expect(result.stderr).toContain('Failed to write bootstrap.json');
    });
  });

  describe('branch vs release provenance', () => {
    it('release install stamps install-method=release', () => {
      runStamp('install-method', 'release', '--source', 'install.sh');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('release');
    });

    it('tagged version install stamps install-method=release', () => {
      runStamp('install-method', 'release', '--source', 'install.sh');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('release');
    });

    it('branch install stamps install-method=source', () => {
      runStamp('install-method', 'source', '--source', 'install.sh');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('source');
    });

    it('branch-fallback install stamps install-method=source', () => {
      runStamp('install-method', 'source', '--source', 'install.sh');

      const stamp = readStamp('install-method');
      expect(stamp?.installMethod).toBe('source');
    });
  });
});
