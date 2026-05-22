// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let ensureInstanceId: typeof import('./install-metadata.js').ensureInstanceId;
let ensureLegacyUpgradeMarker: typeof import('./install-metadata.js').ensureLegacyUpgradeMarker;
let readBootstrapMarker: typeof import('./install-metadata.js').readBootstrapMarker;
let readIdentity: typeof import('./install-metadata.js').readIdentity;
let readInstallMethod: typeof import('./install-metadata.js').readInstallMethod;
let readInstallMethodOrUnknown: typeof import('./install-metadata.js').readInstallMethodOrUnknown;
let resolveTelemetryMode: typeof import('./install-metadata.js').resolveTelemetryMode;
let writeBootstrapMarker: typeof import('./install-metadata.js').writeBootstrapMarker;
let writeInstallMethod: typeof import('./install-metadata.js').writeInstallMethod;

describe('telemetry install metadata', () => {
  let tempDir: string;
  let readOnlyDirs: string[];
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerve-telemetry-metadata-'));
    readOnlyDirs = [];
    process.env = {
      ...originalEnv,
      NERVE_TELEMETRY_DIR: tempDir,
    };

    vi.resetModules();
    const mod = await import('./install-metadata.js');
    ensureInstanceId = mod.ensureInstanceId;
    ensureLegacyUpgradeMarker = mod.ensureLegacyUpgradeMarker;
    readBootstrapMarker = mod.readBootstrapMarker;
    readIdentity = mod.readIdentity;
    readInstallMethod = mod.readInstallMethod;
    readInstallMethodOrUnknown = mod.readInstallMethodOrUnknown;
    resolveTelemetryMode = mod.resolveTelemetryMode;
    writeBootstrapMarker = mod.writeBootstrapMarker;
    writeInstallMethod = mod.writeInstallMethod;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    for (const dir of readOnlyDirs) {
      fs.chmodSync(dir, 0o700);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeReadOnlyDir(name: string): string {
    const dir = path.join(tempDir, name);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o500);
    readOnlyDirs.push(dir);
    return dir;
  }

  it('defaults a trusted fresh install to minimal when env mode is unset', () => {
    expect(resolveTelemetryMode({
      envMode: undefined,
      bootstrap: { kind: 'fresh_install', stampedAt: '2026-04-21T00:00:00Z', source: 'setup' },
    })).toBe('minimal');
  });

  it('treats a fresh release install marker the same way even when setup is skipped', () => {
    expect(resolveTelemetryMode({
      envMode: undefined,
      bootstrap: { kind: 'fresh_install', stampedAt: '2026-04-21T00:00:00Z', source: 'install.sh' },
    })).toBe('minimal');
  });

  it('keeps legacy upgrades off when env mode is unset', () => {
    expect(resolveTelemetryMode({
      envMode: undefined,
      bootstrap: { kind: 'upgrade_legacy', stampedAt: '2026-04-21T00:00:00Z', source: 'runtime' },
    })).toBe('off');
  });

  it('fails closed to off when NERVE_TELEMETRY_MODE is set to an invalid value', () => {
    expect(resolveTelemetryMode({
      envMode: ' definitely-not-valid ',
      bootstrap: { kind: 'fresh_install', stampedAt: '2026-04-21T00:00:00Z', source: 'setup' },
    })).toBe('off');
  });

  it('fails closed to off when NERVE_TELEMETRY_MODE is whitespace-only', () => {
    expect(resolveTelemetryMode({
      envMode: '   ',
      bootstrap: { kind: 'fresh_install', stampedAt: '2026-04-21T00:00:00Z', source: 'setup' },
    })).toBe('off');
  });

  it('falls back to unknown install method when the stamp is missing', () => {
    expect(readInstallMethodOrUnknown(undefined)).toBe('unknown');
  });

  it('keeps an existing release stamp intact', () => {
    const current = { installMethod: 'release' as const, stampedAt: '2026-04-21T00:00:00Z', source: 'install.sh' as const };
    expect(readInstallMethodOrUnknown(current)).toBe('release');
  });

  it('persists a stable instance id once created', () => {
    const first = ensureInstanceId();
    const second = ensureInstanceId();

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);

    const stored = JSON.parse(fs.readFileSync(path.join(tempDir, 'identity.json'), 'utf8'));
    expect(stored.instanceId).toBe(first);
  });

  it('keeps the instance id stable within the process when identity writes fail', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = ensureInstanceId('2026-04-21T00:00:00Z');
    const second = ensureInstanceId('2026-04-22T00:00:00Z');

    expect(first).toBe(second);
    expect(readIdentity()).toBeUndefined();
    expect(warnSpy.mock.calls.map(call => call.join(' ')).join('\n')).toContain('Failed to write identity.json');

    writeSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('writes and reads install method stamps', () => {
    const written = writeInstallMethod('source', 'setup', '2026-04-21T00:00:00Z');

    expect(readInstallMethod()).toEqual(written);
  });

  it('writes and reads bootstrap markers', () => {
    const written = writeBootstrapMarker('fresh_install', 'setup', '2026-04-21T00:00:00Z');

    expect(readBootstrapMarker()).toEqual(written);
  });

  it('defaults local telemetry metadata to a checkout-scoped .nerve directory', async () => {
    process.env = {
      ...originalEnv,
      NERVE_PROJECT_ROOT: tempDir,
    };

    vi.resetModules();
    ({ writeBootstrapMarker } = await import('./install-metadata.js'));

    writeBootstrapMarker('fresh_install', 'setup', '2026-04-21T00:00:00Z');

    const stored = JSON.parse(fs.readFileSync(path.join(tempDir, '.nerve', 'telemetry', 'bootstrap.json'), 'utf8'));
    expect(stored.kind).toBe('fresh_install');
    expect(stored.source).toBe('setup');
  });

  it('writes a legacy upgrade marker only when no trusted fresh-install marker exists', () => {
    const written = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-21T00:00:00Z' });

    expect(written).toEqual({ kind: 'upgrade_legacy', stampedAt: '2026-04-21T00:00:00Z', source: 'runtime' });
    expect(readBootstrapMarker()).toEqual(written);
  });

  it('does not overwrite a trusted fresh-install marker when ensuring a legacy upgrade marker', () => {
    const current = writeBootstrapMarker('fresh_install', 'install.sh', '2026-04-21T00:00:00Z');

    const result = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-22T00:00:00Z' });

    expect(result).toEqual(current);
    expect(readBootstrapMarker()).toEqual(current);
  });

  it('warns and continues when install-method metadata cannot be written', () => {
    process.env.NERVE_TELEMETRY_DIR = makeReadOnlyDir('readonly-install-method');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const written = writeInstallMethod('source', 'setup', '2026-04-21T00:00:00Z');

    expect(written).toEqual({ installMethod: 'source', stampedAt: '2026-04-21T00:00:00Z', source: 'setup' });
    expect(readInstallMethod()).toBeUndefined();
    expect(warnSpy.mock.calls.map(call => call.join(' ')).join('\n')).toContain('Failed to write install-method.json');
  });

  it('warns and continues when legacy bootstrap metadata cannot be written', () => {
    process.env.NERVE_TELEMETRY_DIR = makeReadOnlyDir('readonly-bootstrap');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const written = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-21T00:00:00Z' });

    expect(written).toEqual({ kind: 'upgrade_legacy', stampedAt: '2026-04-21T00:00:00Z', source: 'runtime' });
    expect(readBootstrapMarker()).toBeUndefined();
    expect(warnSpy.mock.calls.map(call => call.join(' ')).join('\n')).toContain('Failed to write bootstrap.json');
  });

  describe('runtime legacy upgrade bootstrap', () => {
    it('stamps upgrade_legacy at runtime when no bootstrap marker exists', () => {
      expect(readBootstrapMarker()).toBeUndefined();

      const result = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-21T12:00:00Z' });

      expect(result).toEqual({
        kind: 'upgrade_legacy',
        stampedAt: '2026-04-21T12:00:00Z',
        source: 'runtime',
      });
      expect(readBootstrapMarker()).toEqual(result);
    });

    it('does not stamp upgrade_legacy when explicit NERVE_TELEMETRY_MODE is set', () => {
      expect(readBootstrapMarker()).toBeUndefined();

      const result = ensureLegacyUpgradeMarker({ envMode: 'detailed', stampedAt: '2026-04-21T12:00:00Z' });

      expect(result).toBeUndefined();
      expect(readBootstrapMarker()).toBeUndefined();
    });

    it('does not stamp upgrade_legacy when explicit NERVE_TELEMETRY_MODE is invalid', () => {
      expect(readBootstrapMarker()).toBeUndefined();

      const result = ensureLegacyUpgradeMarker({ envMode: 'bogus', stampedAt: '2026-04-21T12:00:00Z' });

      expect(result).toBeUndefined();
      expect(readBootstrapMarker()).toBeUndefined();
    });

    it('preserves existing upgrade_legacy marker on repeated runtime calls', () => {
      const first = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-21T12:00:00Z' });
      const second = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-22T12:00:00Z' });

      expect(second).toEqual(first);
      expect(readBootstrapMarker()).toEqual(first);
    });

    it('returns existing fresh_install marker without modification', () => {
      const original = writeBootstrapMarker('fresh_install', 'setup', '2026-04-20T00:00:00Z');

      const result = ensureLegacyUpgradeMarker({ envMode: undefined, stampedAt: '2026-04-21T12:00:00Z' });

      expect(result).toEqual(original);
      expect(readBootstrapMarker()?.kind).toBe('fresh_install');
    });
  });
});
