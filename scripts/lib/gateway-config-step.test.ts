import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GatewayLocation } from './gateway-locality.js';

// Hoisted, so no module in this file can reach the real execSync: the local
// path runs `openclaw gateway restart` and, failing that, `pkill`.
const { execSyncMock } = vi.hoisted(() => ({ execSyncMock: vi.fn(() => Buffer.from('')) }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, default: { ...actual, execSync: execSyncMock }, execSync: execSyncMock };
});

const FULL_OPERATOR_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
];

const LOCAL: GatewayLocation = { locality: 'local', host: '127.0.0.1' };
const REMOTE: GatewayLocation = { locality: 'remote', host: 'gw.example.com' };
const UNKNOWN: GatewayLocation = { locality: 'unknown', host: null };
const TAILNET_ORIGIN = 'http://100.64.0.42:3080';

/** A printed line without colours, the setup rail, or the leading status glyph. */
function plainLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/^ {2}\u2502 {2}/, '').replace(/^[^\w\s] /u, '');
}

/** Every file under a directory, keyed by relative path, so a test can prove nothing changed. */
function snapshotTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files[path.relative(root, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

/** Import the step fresh, after the temp HOME is set: gateway-detect reads HOME at load time. */
async function importStep(): Promise<{
  execSyncMock: typeof execSyncMock;
  mod: typeof import('./gateway-config-step.js');
}> {
  vi.resetModules();
  const mod = await import('./gateway-config-step.js');
  return { execSyncMock, mod };
}

describe('gateway config step', () => {
  const originalEnv = { ...process.env };
  let tempHome = '';
  let output: string[] = [];

  const openclawConfigPath = (): string => path.join(tempHome, '.openclaw', 'openclaw.json');
  const readOpenclawConfig = () => JSON.parse(readFileSync(openclawConfigPath(), 'utf8'));

  beforeEach(() => {
    vi.restoreAllMocks();
    execSyncMock.mockClear();
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'nerve-gateway-step-'));
    process.env.HOME = tempHome;
    process.env.NERVE_DATA_DIR = path.join(tempHome, '.nerve');
    delete process.env.OPENCLAW_CONFIG_PATH;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.NERVE_INSTALLER;

    mkdirSync(path.join(tempHome, '.openclaw', 'devices'), { recursive: true });
    mkdirSync(path.join(tempHome, '.openclaw', 'identity'), { recursive: true });
    mkdirSync(path.join(tempHome, '.nerve'), { recursive: true });

    // A local gateway that is fully paired but still needs sessions_spawn and the tailnet origin.
    writeFileSync(openclawConfigPath(), JSON.stringify({
      gateway: {
        port: 18789,
        auth: { token: 'test-token' },
        tools: { allow: ['cron', 'gateway'] },
        controlUi: { allowedOrigins: ['http://localhost:3080'] },
      },
    }, null, 2));
    writeFileSync(path.join(tempHome, '.nerve', 'device-identity.json'), JSON.stringify({
      deviceId: 'nerve-device',
      publicKeyB64url: 'nerve-public-key',
    }, null, 2));
    writeFileSync(path.join(tempHome, '.openclaw', 'devices', 'paired.json'), JSON.stringify({
      'gateway-device': {
        deviceId: 'gateway-device',
        scopes: FULL_OPERATOR_SCOPES,
        tokens: { operator: { token: 'gateway-token', scopes: FULL_OPERATOR_SCOPES } },
      },
      'nerve-device': {
        deviceId: 'nerve-device',
        scopes: FULL_OPERATOR_SCOPES,
        displayName: 'Nerve UI',
        platform: 'web',
        clientId: 'webchat-ui',
        clientMode: 'webchat',
        tokens: { operator: { token: 'test-token', scopes: FULL_OPERATOR_SCOPES } },
      },
    }, null, 2));
    writeFileSync(path.join(tempHome, '.openclaw', 'identity', 'device.json'), JSON.stringify({
      deviceId: 'gateway-device',
    }, null, 2));
    writeFileSync(path.join(tempHome, '.openclaw', 'identity', 'device-auth.json'), JSON.stringify({
      version: 1,
      deviceId: 'gateway-device',
      tokens: { operator: { token: 'gateway-token', scopes: FULL_OPERATOR_SCOPES } },
    }, null, 2));

    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(plainLine(args.map(String).join(' ')));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  });

  describe('remote gateway', () => {
    it.each([
      ['non-interactive', undefined],
      ['interactive', vi.fn(async () => true)],
    ])('%s: writes nothing locally, restarts nothing, and prints the steps for the gateway host', async (_mode, confirm) => {
      const { mod, execSyncMock } = await importStep();
      const before = snapshotTree(tempHome);
      const wait = vi.fn(async () => {});

      await mod.runGatewayConfigStep({
        location: REMOTE,
        allowedOrigins: [TAILNET_ORIGIN],
        gatewayToken: 'remote-token',
        port: '3080',
        confirm,
        wait,
      });

      expect(snapshotTree(tempHome)).toEqual(before);
      expect(execSyncMock).not.toHaveBeenCalled();
      expect(wait).not.toHaveBeenCalled();
      if (confirm) expect(confirm).not.toHaveBeenCalled();

      expect(output).toEqual([
        '',
        'The gateway at gw.example.com is on another machine, so setup did not change any OpenClaw config.',
        'Make these changes on gw.example.com:',
        `  • Origins: add ${TAILNET_ORIGIN}, http://localhost:3080, http://127.0.0.1:3080 to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json`,
        '  • HTTP tools: add "sessions_spawn" to gateway.tools.allow in ~/.openclaw/openclaw.json',
        '  • Restart: run `openclaw gateway restart` after saving the config',
        '  • Device: after starting Nerve, run `openclaw devices list`, then `openclaw devices approve <requestId>` for the Nerve request',
      ]);
    });

    it.each([
      [
        'no-local-openclaw',
        'This machine runs no OpenClaw, so the gateway at 127.0.0.1 is forwarded from elsewhere (an SSH tunnel or a container) and setup did not change any OpenClaw config.',
      ],
      [
        'override',
        "NERVE_GATEWAY_LOCATION=remote is set, so setup did not change this machine's OpenClaw config.",
      ],
    ] as const)('a forwarded gateway (%s): writes nothing, restarts nothing, and says where the steps go', async (forwarded, headline) => {
      const { mod, execSyncMock } = await importStep();
      const before = snapshotTree(tempHome);

      await mod.runGatewayConfigStep({
        location: { locality: 'remote', host: '127.0.0.1', forwarded },
        allowedOrigins: [],
        gatewayToken: 'remote-token',
        port: '3080',
      });

      expect(snapshotTree(tempHome)).toEqual(before);
      expect(execSyncMock).not.toHaveBeenCalled();
      expect(output.slice(0, 3)).toEqual(['', headline, 'Make these changes where the gateway runs:']);
      expect(mod.manualTokenHint({ locality: 'remote', host: '127.0.0.1', forwarded }, false)).toEqual([
        'Find the token on the gateway host in ~/.openclaw/openclaw.json, or run there: openclaw gateway status',
      ]);
    });

    it('lists the loopback origins when Nerve itself stays on localhost', async () => {
      const { mod } = await importStep();

      await mod.runGatewayConfigStep({
        location: REMOTE,
        allowedOrigins: [],
        gatewayToken: 'remote-token',
        port: '4000',
      });

      expect(output).toContain(
        '  • Origins: add http://localhost:4000, http://127.0.0.1:4000 to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json',
      );
    });
  });

  describe('local gateway', () => {
    it('non-interactive: patches the local config and restarts the gateway, as before', async () => {
      const { mod, execSyncMock } = await importStep();
      const wait = vi.fn(async () => {});

      await mod.runGatewayConfigStep({
        location: LOCAL,
        allowedOrigins: [TAILNET_ORIGIN],
        gatewayToken: 'test-token',
        port: '3080',
        wait,
      });

      const updated = readOpenclawConfig();
      expect(updated.gateway.tools.allow).toEqual(['cron', 'gateway', 'sessions_spawn']);
      expect(updated.gateway.controlUi.allowedOrigins).toEqual(['http://localhost:3080', TAILNET_ORIGIN]);
      expect(execSyncMock).toHaveBeenCalledWith('openclaw gateway restart', expect.objectContaining({ timeout: 15000 }));
      expect(wait).toHaveBeenCalledWith(3000);
      expect(output).toContain('Gateway configuration updated');
      expect(output.join('\n')).not.toContain('another machine');
    });

    it('interactive: asks first, then patches and restarts', async () => {
      const { mod, execSyncMock } = await importStep();
      const confirm = vi.fn(async () => true);

      await mod.runGatewayConfigStep({
        location: LOCAL,
        allowedOrigins: [TAILNET_ORIGIN],
        gatewayToken: 'test-token',
        port: '3080',
        confirm,
        wait: async () => {},
      });

      expect(confirm).toHaveBeenCalledWith('Apply these changes?');
      expect(output).toContain('Nerve needs to update your OpenClaw gateway config.');
      expect(readOpenclawConfig().gateway.tools.allow).toContain('sessions_spawn');
      expect(execSyncMock).toHaveBeenCalledWith('openclaw gateway restart', expect.anything());
    });

    it('interactive: prints the manual fixes and writes nothing when the user declines', async () => {
      const { mod, execSyncMock } = await importStep();
      const before = snapshotTree(tempHome);

      await mod.runGatewayConfigStep({
        location: LOCAL,
        allowedOrigins: [TAILNET_ORIGIN],
        gatewayToken: 'test-token',
        port: '3080',
        confirm: async () => false,
      });

      expect(snapshotTree(tempHome)).toEqual(before);
      expect(execSyncMock).not.toHaveBeenCalled();
      expect(output.slice(-3)).toEqual([
        'Skipped gateway config changes. Some features may not work:',
        '  • HTTP tools: add "sessions_spawn" to gateway.tools.allow in ~/.openclaw/openclaw.json',
        '  • Origins: add the required origin(s) to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json',
      ]);
    });

    it('treats an unknown location like a local one', async () => {
      const { mod, execSyncMock } = await importStep();

      await mod.runGatewayConfigStep({
        location: UNKNOWN,
        allowedOrigins: [],
        gatewayToken: 'test-token',
        port: '3080',
        wait: async () => {},
      });

      expect(readOpenclawConfig().gateway.tools.allow).toContain('sessions_spawn');
      expect(execSyncMock).toHaveBeenCalledWith('openclaw gateway restart', expect.anything());
    });
  });

  describe('wording', () => {
    it('keeps the skipped-change hints as they were', async () => {
      const { mod } = await importStep();

      expect(mod.skippedChangeHint('device-scopes')).toBe('Device scopes: manually fix scopes in ~/.openclaw/devices/paired.json');
      expect(mod.skippedChangeHint('pre-pair')).toBe('Pre-pair: run `openclaw devices approve` after starting Nerve');
      expect(mod.skippedChangeHint('allowed-origins-https')).toBe(
        'Origins: add the required origin(s) to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json',
      );
      expect(mod.skippedChangeHint('something-else')).toBeNull();
    });

    it('dedupes remote origins and keeps the access plan origins first', async () => {
      const { mod } = await importStep();

      expect(mod.remoteGatewayOrigins(undefined, '3080')).toEqual(['http://localhost:3080', 'http://127.0.0.1:3080']);
      expect(mod.remoteGatewayOrigins([' https://nerve.example.com ', 'http://localhost:3080'], '3080')).toEqual([
        'https://nerve.example.com',
        'http://localhost:3080',
        'http://127.0.0.1:3080',
      ]);
    });

    it('labels a locally detected token when the gateway is remote and defaults to No', async () => {
      const { mod } = await importStep();

      expect(mod.detectedTokenPrompt({ source: 'detected', token: 'abc', location: REMOTE })).toEqual({
        message: 'Found this machine\'s OpenClaw token (abc), which may not match the gateway at gw.example.com. Use it anyway?',
        default: false,
      });
      expect(mod.detectedTokenPrompt({ source: 'detected', token: 'abc', location: LOCAL })).toEqual({
        message: 'Use detected token (abc)?',
        default: true,
      });
      expect(mod.detectedTokenPrompt({ source: 'env', token: 'abc', location: REMOTE })).toEqual({
        message: 'Use environment token (abc)?',
        default: true,
      });
    });

    it('warns in non-interactive mode when a locally detected token is used for a remote gateway', async () => {
      const { mod } = await importStep();

      expect(mod.detectedTokenNotice('detected', REMOTE)).toEqual({
        level: 'warn',
        message: 'Using this machine\'s OpenClaw token, which may not match the gateway at gw.example.com. If the check below fails, set GATEWAY_TOKEN in .env to that gateway\'s token.',
      });
      expect(mod.detectedTokenNotice('detected', LOCAL)).toEqual({ level: 'success', message: 'Auto-detected gateway token' });
      expect(mod.detectedTokenNotice('env', REMOTE)).toEqual({
        level: 'success',
        message: 'Auto-detected gateway token from environment',
      });
    });

    it('points manual token lookup at the gateway host when it is remote', async () => {
      const { mod } = await importStep();

      expect(mod.manualTokenHint(REMOTE, true)).toEqual([
        'Find the token on gw.example.com in ~/.openclaw/openclaw.json, or run there: openclaw gateway status',
      ]);
      expect(mod.manualTokenHint(LOCAL, false)).toEqual([
        'Find your token in ~/.openclaw/openclaw.json or run: openclaw gateway status',
      ]);
      expect(mod.manualTokenHint(UNKNOWN, true)).toHaveLength(2);
    });
  });
});
