/** Tests for the GET /api/server-info endpoint. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';

let execFileImpl: (...args: unknown[]) => void;
let readFileImpl: (...args: unknown[]) => Promise<string>;

const runtime = vi.hoisted(() => ({
  platform: 'linux' as NodeJS.Platform,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const mock = { ...actual, platform: () => runtime.platform };
  return { ...mock, default: mock };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = { ...actual, execFile: (...args: unknown[]) => execFileImpl(...args) };
  return { ...mock, default: mock };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const mock = {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: (...args: unknown[]) => readFileImpl(...args),
    },
  };
  return { ...mock, default: mock };
});

vi.mock('../lib/config.js', () => ({
  config: { agentName: 'Jen' },
}));

vi.mock('../middleware/rate-limit.js', () => ({
  rateLimitGeneral: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));

async function buildApp(platform: NodeJS.Platform) {
  runtime.platform = platform;
  vi.resetModules();
  const mod = await import('./server-info.js');
  const app = new Hono();
  app.route('/', mod.default);
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('GET /api/server-info', () => {
  it('returns Linux gateway start time from /proc', async () => {
    execFileImpl = (file, args, _opts, cb) => {
      expect(file).toBe('pgrep');
      expect(args).toEqual(['-f', 'openclaw-gatewa']);
      (cb as (err: Error | null, stdout: string) => void)(null, '72246\n');
    };

    readFileImpl = async (filePath) => {
      if (filePath === '/proc/72246/stat') {
        const afterCommFields = [
          'S', '1', '2', '3', '4', '5', '6', '7', '8', '9',
          '10', '11', '12', '13', '14', '15', '16', '17', '18', '1234',
        ];
        return `72246 (openclaw-gateway) ${afterCommFields.join(' ')}`;
      }
      if (filePath === '/proc/stat') {
        return 'cpu 1 2 3 4\nbtime 1700000000\n';
      }
      throw new Error(`Unexpected read: ${String(filePath)}`);
    };

    const app = await buildApp('linux');
    const res = await app.request('/api/server-info');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.gatewayStartedAt).toBe(1700000012340);
    expect(typeof json.serverTime).toBe('number');
    expect(json.agentName).toBe('Jen');
  });

  it('returns macOS gateway start time from ps output', async () => {
    const execCalls: Array<{ file: unknown; args: unknown }> = [];

    execFileImpl = (file, args, _opts, cb) => {
      execCalls.push({ file, args });
      if (file === 'ps' && Array.isArray(args) && args[0] === '-axo') {
        (cb as (err: Error | null, stdout: string) => void)(null, '72245 openclaw\n72246 openclaw-gateway\n');
        return;
      }
      if (file === 'ps' && Array.isArray(args) && args[0] === '-p') {
        (cb as (err: Error | null, stdout: string) => void)(null, 'Tue Mar 31 20:14:31 2026\n');
        return;
      }
      throw new Error(`Unexpected exec: ${String(file)}`);
    };

    readFileImpl = async () => {
      throw new Error('macOS path should not read /proc');
    };

    const app = await buildApp('darwin');
    const res = await app.request('/api/server-info');
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    expect(json.gatewayStartedAt).toBe(new Date('Tue Mar 31 20:14:31 2026').getTime());
    expect(execCalls).toEqual([
      { file: 'ps', args: ['-axo', 'pid=,comm='] },
      { file: 'ps', args: ['-p', '72246', '-o', 'lstart='] },
    ]);
  });
});
