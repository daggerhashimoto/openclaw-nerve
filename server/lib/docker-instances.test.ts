import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let execFileImpl: (...args: unknown[]) => void;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mock = { ...actual, execFile: (...args: unknown[]) => execFileImpl(...args) };
  return { ...mock, default: mock };
});

import {
  createDockerInstance,
  getInstanceToken,
  listCopyableMasterCredentials,
  removeLocalOpenClawInstance,
  stopLocalOpenClawInstance,
} from './docker-instances.js';

describe('docker-instances helper', () => {
  let tmpRoot: string;
  let originalDefaultImage: string | undefined;
  let originalGatewayToken: string | undefined;
  let originalOpenAiKey: string | undefined;
  let originalNotionKey: string | undefined;
  let originalStateDir: string | undefined;
  let originalInstanceRoot: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nerve-multiclaw-test-'));

    originalDefaultImage = process.env.MULTICLAW_DEFAULT_IMAGE;
    originalGatewayToken = process.env.GATEWAY_TOKEN;
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    originalNotionKey = process.env.NOTION_API_KEY;
    originalStateDir = process.env.OPENCLAW_STATE_DIR;
    originalInstanceRoot = process.env.MULTICLAW_INSTANCE_ROOT;

    process.env.OPENCLAW_STATE_DIR = path.join(tmpRoot, '.openclaw');
    process.env.MULTICLAW_INSTANCE_ROOT = path.join(tmpRoot, 'instances');

    fs.mkdirSync(path.join(process.env.OPENCLAW_STATE_DIR, 'agents', 'main', 'agent'), { recursive: true });
  });

  afterEach(() => {
    if (originalDefaultImage === undefined) delete process.env.MULTICLAW_DEFAULT_IMAGE;
    else process.env.MULTICLAW_DEFAULT_IMAGE = originalDefaultImage;
    if (originalGatewayToken === undefined) delete process.env.GATEWAY_TOKEN;
    else process.env.GATEWAY_TOKEN = originalGatewayToken;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalNotionKey === undefined) delete process.env.NOTION_API_KEY;
    else process.env.NOTION_API_KEY = originalNotionKey;
    if (originalStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = originalStateDir;
    if (originalInstanceRoot === undefined) delete process.env.MULTICLAW_INSTANCE_ROOT;
    else process.env.MULTICLAW_INSTANCE_ROOT = originalInstanceRoot;

    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns env + auth-profile credential metadata', () => {
    process.env.GATEWAY_TOKEN = 'abc';
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENAI_API_KEY;
    process.env.NOTION_API_KEY = 'ntn_test';

    fs.writeFileSync(
      path.join(process.env.OPENCLAW_STATE_DIR || '', 'agents', 'main', 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: { 'openai-codex:default': { type: 'oauth' } } }),
      'utf8',
    );

    const creds = listCopyableMasterCredentials();
    expect(creds).toEqual(
      expect.arrayContaining([
        { key: 'ENV:OPENAI_API_KEY', isSet: false },
        { key: 'ENV:REPLICATE_API_TOKEN', isSet: false },
        { key: 'AUTH_PROFILE:openai-codex:default', isSet: true },
      ]),
    );
    expect(creds.some((entry) => entry.key === 'ENV:GATEWAY_TOKEN')).toBe(false);
    expect(creds.some((entry) => entry.key === 'ENV:OPENCLAW_GATEWAY_TOKEN')).toBe(false);
  });

  it('creates a docker instance and prepares state with selected env + auth profiles', async () => {
    process.env.MULTICLAW_DEFAULT_IMAGE = 'multiclaw:test';
    process.env.OPENAI_API_KEY = 'openai-test-key';
    fs.writeFileSync(path.join(process.env.OPENCLAW_STATE_DIR || '', '.env'), 'OPENAI_API_KEY=openai-test-key\n', 'utf8');

    fs.writeFileSync(
      path.join(process.env.OPENCLAW_STATE_DIR || '', 'agents', 'main', 'agent', 'auth-profiles.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          'openai-codex:default': { type: 'oauth', token: 't1' },
          'anthropic:default': { type: 'apiKey', key: 'k2' },
        },
      }),
      'utf8',
    );

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];
      if (dockerArgs[0] === 'run') {
        expect(dockerArgs).toEqual(
          expect.arrayContaining([
            '-d',
            '--name',
            'worker-a',
            '-p',
            '0:3080',
            '-p',
            '0:3181',
            '-e',
            'NERVE_ALLOW_INSECURE=true',
            'OPENAI_API_KEY=openai-test-key',
            'multiclaw:test',
          ]),
        );
        expect(dockerArgs).toContain('-v');
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-a\n', '');
        return;
      }

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-a',
            Name: '/worker-a',
            Created: '2026-03-02T00:00:00Z',
            Config: {
              Image: 'multiclaw:test',
              Env: ['OPENAI_API_KEY=openai-test-key'],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: { '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31001' }] },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('unexpected args'), '', '');
    };

    const created = await createDockerInstance({
      name: 'worker-a',
      credentialKeys: ['ENV:OPENAI_API_KEY', 'AUTH_PROFILE:openai-codex:default'],
    });

    expect(created.type).toBe('docker');
    expect(created.image).toBe('multiclaw:test');
    expect(created.copiedCredentialKeys).toEqual(['ENV:OPENAI_API_KEY', 'AUTH_PROFILE:openai-codex:default']);
    expect(created.instance.id).toBe('cid-worker-a');

    const stateDir = path.join(process.env.MULTICLAW_INSTANCE_ROOT || '', 'worker-a', '.openclaw');
    const envFile = fs.readFileSync(path.join(stateDir, '.env'), 'utf8');
    expect(envFile).toContain('OPENAI_API_KEY=openai-test-key');

    const copiedAuthRaw = fs.readFileSync(path.join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json'), 'utf8');
    const copiedAuth = JSON.parse(copiedAuthRaw) as { profiles: Record<string, unknown> };
    expect(Object.keys(copiedAuth.profiles)).toEqual(['openai-codex:default']);

    const openclawConfigRaw = fs.readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8');
    const openclawConfig = JSON.parse(openclawConfigRaw) as {
      agents?: { defaults?: { model?: { primary?: string } } };
      gateway?: { auth?: { mode?: string; token?: string } };
    };
    expect(openclawConfig.agents?.defaults?.model?.primary).toBe('openai-codex/gpt-5.3-codex');
    expect(openclawConfig.gateway?.auth?.mode).toBe('token');
    expect(openclawConfig.gateway?.auth?.token).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('auto-copies a default auth profile when none is selected so agent startup has model auth', async () => {
    process.env.MULTICLAW_DEFAULT_IMAGE = 'multiclaw:test';

    fs.writeFileSync(
      path.join(process.env.OPENCLAW_STATE_DIR || '', 'agents', 'main', 'agent', 'auth-profiles.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          'openai-codex:default': { type: 'oauth', token: 't-openai' },
        },
        lastGood: {
          'openai-codex': 'openai-codex:default',
        },
      }),
      'utf8',
    );

    fs.writeFileSync(
      path.join(process.env.OPENCLAW_STATE_DIR || '', 'openclaw.json'),
      JSON.stringify({ skills: { entries: { notion: { apiKey: 'ntn_from_master' } } } }),
      'utf8',
    );

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'run') {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-auto-auth\n', '');
        return;
      }

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-auto-auth',
            Name: '/worker-auto-auth',
            Config: {
              Image: 'multiclaw:test',
              Env: [],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: {
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31005' }],
                '3181/tcp': [{ HostIp: '0.0.0.0', HostPort: '31006' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    const created = await createDockerInstance({
      name: 'worker-auto-auth',
      credentialKeys: ['OPENCLAW_JSON_ENTRY:skills.entries.notion'],
    });

    expect(created.copiedCredentialKeys).toEqual([
      'OPENCLAW_JSON_ENTRY:skills.entries.notion',
      'AUTH_PROFILE:openai-codex:default',
    ]);

    const stateDir = path.join(process.env.MULTICLAW_INSTANCE_ROOT || '', 'worker-auto-auth', '.openclaw');
    const copiedAuthRaw = fs.readFileSync(path.join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json'), 'utf8');
    const copiedAuth = JSON.parse(copiedAuthRaw) as { profiles: Record<string, unknown> };
    expect(Object.keys(copiedAuth.profiles)).toEqual(['openai-codex:default']);

    const copiedConfigRaw = fs.readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8');
    const copiedConfig = JSON.parse(copiedConfigRaw) as { agents?: { defaults?: { model?: { primary?: string } } } };
    expect(copiedConfig.agents?.defaults?.model?.primary).toBe('openai-codex/gpt-5.3-codex');
  });

  it('prefers first local multiclaw image tag when default image env is unset', async () => {
    delete process.env.MULTICLAW_DEFAULT_IMAGE;

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'image' && dockerArgs[1] === 'ls') {
        (cb as (err: null, stdout: string, stderr: string) => void)(
          null,
          'ghcr.io/acme/other:latest\nmulticlaw:e2e\nmulticlaw:dev\n',
          '',
        );
        return;
      }

      if (dockerArgs[0] === 'run') {
        expect(dockerArgs).toContain('multiclaw:e2e');
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-b\n', '');
        return;
      }

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-b',
            Name: '/worker-b',
            Created: '2026-03-02T00:00:00Z',
            Config: {
              Image: 'multiclaw:e2e',
              Env: [],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: { '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31002' }] },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    const created = await createDockerInstance({
      name: 'worker-b',
      credentialKeys: [],
    });

    expect(created.image).toBe('multiclaw:e2e');
  });

  it('copies env vars referenced by selected JSON entry templates into instance .env', async () => {
    process.env.MULTICLAW_DEFAULT_IMAGE = 'multiclaw:test';

    fs.writeFileSync(path.join(process.env.OPENCLAW_STATE_DIR || '', '.env'), 'NOTION_API_KEY=ntn_from_env\n', 'utf8');
    fs.writeFileSync(
      path.join(process.env.OPENCLAW_STATE_DIR || '', 'openclaw.json'),
      JSON.stringify({ skills: { entries: { notion: { apiKey: '${NOTION_API_KEY}' } } } }),
      'utf8',
    );

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'run') {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-notion-template\n', '');
        return;
      }

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-notion-template',
            Name: '/worker-notion-template',
            Config: {
              Image: 'multiclaw:test',
              Env: [],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: {
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31005' }],
                '3181/tcp': [{ HostIp: '0.0.0.0', HostPort: '31006' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    await createDockerInstance({
      name: 'worker-notion-template',
      credentialKeys: ['OPENCLAW_JSON_ENTRY:skills.entries.notion'],
    });

    const stateDir = path.join(process.env.MULTICLAW_INSTANCE_ROOT || '', 'worker-notion-template', '.openclaw');
    const envFile = fs.readFileSync(path.join(stateDir, '.env'), 'utf8');
    expect(envFile).toContain('NOTION_API_KEY=ntn_from_env');

    const copiedConfig = JSON.parse(fs.readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8')) as {
      skills?: { entries?: { notion?: { apiKey?: string } } };
    };
    expect(copiedConfig.skills?.entries?.notion?.apiKey).toBe('${NOTION_API_KEY}');
  });

  it('copies master secrets config when selected JSON entries contain secret refs', async () => {
    process.env.MULTICLAW_DEFAULT_IMAGE = 'multiclaw:test';

    fs.writeFileSync(
      path.join(process.env.OPENCLAW_STATE_DIR || '', 'openclaw.json'),
      JSON.stringify({
        skills: {
          entries: {
            notion: {
              apiKey: { source: 'env', provider: 'default', id: 'NOTION_API_KEY' },
            },
          },
        },
        secrets: {
          providers: {
            env: {
              default: { type: 'env' },
            },
          },
        },
      }),
      'utf8',
    );

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'run') {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-notion-secret\n', '');
        return;
      }

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-notion-secret',
            Name: '/worker-notion-secret',
            Config: {
              Image: 'multiclaw:test',
              Env: [],
              Labels: {},
            },
            State: { Status: 'running' },
            NetworkSettings: {
              Ports: {
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31007' }],
                '3181/tcp': [{ HostIp: '0.0.0.0', HostPort: '31008' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    await createDockerInstance({
      name: 'worker-notion-secret',
      credentialKeys: ['OPENCLAW_JSON_ENTRY:skills.entries.notion'],
    });

    const stateDir = path.join(process.env.MULTICLAW_INSTANCE_ROOT || '', 'worker-notion-secret', '.openclaw');
    const copiedConfig = JSON.parse(fs.readFileSync(path.join(stateDir, 'openclaw.json'), 'utf8')) as {
      secrets?: { providers?: { env?: { default?: { type?: string } } } };
    };
    expect(copiedConfig.secrets?.providers?.env?.default?.type).toBe('env');
  });

  it('reads instance gateway token from mounted openclaw.json when env token is absent', async () => {
    const mountedStateDir = path.join(tmpRoot, 'instance-state');
    fs.mkdirSync(mountedStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(mountedStateDir, 'openclaw.json'),
      JSON.stringify({ gateway: { auth: { token: 'token-from-config' } } }),
      'utf8',
    );

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-c',
            Name: '/worker-c',
            Config: {
              Image: 'multiclaw:e2e',
              Env: [],
              Labels: {},
            },
            State: { Status: 'running' },
            Mounts: [
              {
                Source: mountedStateDir,
                Destination: '/home/node/.openclaw',
              },
            ],
            NetworkSettings: {
              Ports: {
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31003' }],
                '3181/tcp': [{ HostIp: '0.0.0.0', HostPort: '31004' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    const token = await getInstanceToken('cid-worker-c');
    expect(token?.token).toBe('token-from-config');
    expect(token?.tokenKey).toBe('OPENCLAW_JSON:gateway.auth.token');
  });

  it('stops a running local instance', async () => {
    let inspectCount = 0;
    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'inspect') {
        inspectCount += 1;
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-stop',
            Name: '/worker-stop',
            Config: {
              Image: 'multiclaw:e2e',
              Env: [],
              Labels: {},
            },
            State: { Status: inspectCount === 1 ? 'running' : 'exited' },
            NetworkSettings: {
              Ports: {
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31010' }],
                '3181/tcp': [{ HostIp: '0.0.0.0', HostPort: '31011' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      if (dockerArgs[0] === 'stop') {
        expect(dockerArgs).toEqual(['stop', '-t', '2', 'cid-worker-stop']);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-stop\n', '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    const stopped = await stopLocalOpenClawInstance('cid-worker-stop');
    expect(stopped?.state).toBe('exited');
  });

  it('removes a local instance and deletes managed state dir', async () => {
    const managedStateDir = path.join(process.env.MULTICLAW_INSTANCE_ROOT || '', 'worker-remove', '.openclaw');
    fs.mkdirSync(managedStateDir, { recursive: true });
    fs.writeFileSync(path.join(managedStateDir, 'openclaw.json'), '{"ok":true}\n', 'utf8');

    execFileImpl = (_bin: unknown, args: unknown, _opts: unknown, cb: unknown) => {
      const dockerArgs = args as string[];

      if (dockerArgs[0] === 'inspect') {
        const payload = JSON.stringify([
          {
            Id: 'cid-worker-remove',
            Name: '/worker-remove',
            Config: {
              Image: 'multiclaw:e2e',
              Env: [],
              Labels: {},
            },
            State: { Status: 'exited' },
            Mounts: [
              {
                Source: managedStateDir,
                Destination: '/home/node/.openclaw',
              },
            ],
            NetworkSettings: {
              Ports: {
                '3080/tcp': [{ HostIp: '0.0.0.0', HostPort: '31012' }],
                '3181/tcp': [{ HostIp: '0.0.0.0', HostPort: '31013' }],
              },
            },
          },
        ]);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, payload, '');
        return;
      }

      if (dockerArgs[0] === 'rm') {
        expect(dockerArgs).toEqual(['rm', '-f', 'cid-worker-remove']);
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'cid-worker-remove\n', '');
        return;
      }

      (cb as (err: Error, stdout: string, stderr: string) => void)(new Error(`unexpected args: ${dockerArgs.join(' ')}`), '', '');
    };

    const removed = await removeLocalOpenClawInstance('cid-worker-remove');
    expect(removed?.removed).toBe(true);
    expect(removed?.stateDirRemoved).toBe(true);
    expect(fs.existsSync(managedStateDir)).toBe(false);
  });
});
