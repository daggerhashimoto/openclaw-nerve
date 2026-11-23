import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Reporter, ServiceManager } from './types.js';

const mocks = vi.hoisted(() => ({
  rollback: vi.fn(),
  detectServiceManager: vi.fn(),
  checkHealth: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const overrides = { writeFileSync: mocks.writeFileSync, mkdirSync: vi.fn() };
  return { ...actual, ...overrides, default: { ...actual, ...overrides } };
});
vi.mock('./lock.js', () => ({ acquireLock: vi.fn(), releaseLock: vi.fn() }));
vi.mock('./preflight.js', () => ({
  runPreflight: vi.fn(() => ({ gitVersion: '2.0.0', nodeVersion: '22.0.0', npmVersion: '10.0.0' })),
}));
vi.mock('./release-resolver.js', () => ({
  resolveVersion: vi.fn(async () => ({
    current: '1.0.0',
    version: '1.1.0',
    tag: 'v1.1.0',
    source: 'release',
    isUpToDate: false,
  })),
}));
vi.mock('./snapshot.js', () => ({
  createSnapshot: vi.fn(() => ({ ref: 'abcdef1234567890', version: '1.0.0' })),
}));
vi.mock('./installer.js', () => ({ gitFetchAndCheckout: vi.fn(), buildProject: vi.fn() }));
vi.mock('./service-manager.js', () => ({ detectServiceManager: mocks.detectServiceManager }));
vi.mock('./health.js', () => ({
  checkHealth: mocks.checkHealth,
  resolveHealthCheckBaseUrl: vi.fn(() => 'http://127.0.0.1:3080'),
}));
vi.mock('./rollback.js', () => ({ rollback: mocks.rollback }));

const { orchestrate } = await import('./orchestrator.js');
const { EXIT_CODES } = await import('./types.js');

function makeReporter(): Reporter {
  return {
    stage: vi.fn(),
    ok: vi.fn(),
    warn: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
    dry: vi.fn(),
    verbose: vi.fn(),
    hint: vi.fn(),
    cmd: vi.fn(),
    confirm: vi.fn(async () => true),
    done: vi.fn(),
    summary: vi.fn(),
  };
}

function makeServiceManager(overrides: Partial<ServiceManager> = {}): ServiceManager {
  return {
    name: 'systemd',
    detect: () => true,
    restart: vi.fn(async () => {}),
    isActive: vi.fn(async () => true),
    getLogs: vi.fn(async () => ''),
    ...overrides,
  };
}

const options = {
  yes: true,
  dryRun: false,
  verbose: false,
  rollback: false,
  noRestart: false,
  cwd: '/tmp/nerve-test',
};

describe('orchestrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rollback.mockResolvedValue({ success: true, snapshot: { version: '1.0.0' } });
    mocks.checkHealth.mockResolvedValue({ healthy: true, versionMatch: true, reportedVersion: '1.1.0' });
  });

  it('rolls back and exits with the restart code when the restart command throws', async () => {
    const serviceManager = makeServiceManager({
      restart: vi.fn(async () => {
        throw new Error('Command failed: systemctl restart nerve');
      }),
    });
    mocks.detectServiceManager.mockReturnValue(serviceManager);

    const code = await orchestrate(options, makeReporter());

    expect(mocks.rollback).toHaveBeenCalledTimes(1);
    expect(code).toBe(EXIT_CODES.RESTART);
  });

  it('rolls back when the service is not active after a restart', async () => {
    const serviceManager = makeServiceManager({ isActive: vi.fn(async () => false) });
    mocks.detectServiceManager.mockReturnValue(serviceManager);
    vi.useFakeTimers();
    try {
      const pending = orchestrate(options, makeReporter());
      await vi.runAllTimersAsync();
      const code = await pending;

      expect(mocks.rollback).toHaveBeenCalledTimes(1);
      expect(code).toBe(EXIT_CODES.RESTART);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the rollback code when the rollback itself fails', async () => {
    const serviceManager = makeServiceManager({
      restart: vi.fn(async () => {
        throw new Error('Command failed');
      }),
    });
    mocks.detectServiceManager.mockReturnValue(serviceManager);
    mocks.rollback.mockResolvedValue({ success: false, error: 'checkout failed' });

    const code = await orchestrate(options, makeReporter());

    expect(code).toBe(EXIT_CODES.ROLLBACK);
  });
});
