import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXAMPLE_TS_DNS = 'example-node.tail0000.ts.net';
const EXAMPLE_TS_IPV4 = '100.64.0.42';

const FULL_OPERATOR_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
];

describe('detectNeededConfigChanges', () => {
  const originalEnv = { ...process.env };
  let tempHome = '';

  beforeEach(() => {
    vi.resetModules();
    tempHome = mkdtempSync(path.join(os.tmpdir(), 'nerve-gateway-detect-'));
    process.env.HOME = tempHome;
    process.env.NERVE_DATA_DIR = path.join(tempHome, '.nerve');

    mkdirSync(path.join(tempHome, '.openclaw', 'devices'), { recursive: true });
    mkdirSync(path.join(tempHome, '.openclaw'), { recursive: true });
    mkdirSync(path.join(tempHome, '.nerve'), { recursive: true });

    writeFileSync(path.join(tempHome, '.openclaw', 'openclaw.json'), JSON.stringify({
      gateway: {
        port: 18789,
        auth: { token: 'test-token' },
        tools: { allow: ['cron', 'gateway'] },
        controlUi: {
          allowedOrigins: ['http://localhost:3080'],
        },
      },
    }, null, 2));

    writeFileSync(path.join(tempHome, '.nerve', 'device-identity.json'), JSON.stringify({
      deviceId: 'nerve-device',
    }, null, 2));

    writeFileSync(path.join(tempHome, '.openclaw', 'devices', 'paired.json'), JSON.stringify({
      'nerve-device': {
        scopes: FULL_OPERATOR_SCOPES,
        displayName: 'Nerve UI',
        platform: 'web',
        clientId: 'webchat-ui',
        clientMode: 'webchat',
        tokens: {
          operator: {
            token: 'test-token',
          },
        },
      },
    }, null, 2));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  });

  it('emits one change per missing origin and patches both when applied', async () => {
    const { detectNeededConfigChanges } = await import('./gateway-detect.js');

    const changes = detectNeededConfigChanges({
      gatewayToken: 'test-token',
      allowedOrigins: [
        `  http://${EXAMPLE_TS_IPV4}:3080  `,
        `https://${EXAMPLE_TS_DNS}`,
      ],
    });

    expect(changes.some(change => change.description.includes(`${EXAMPLE_TS_IPV4}:3080`))).toBe(true);
    expect(changes.some(change => change.description.includes(EXAMPLE_TS_DNS))).toBe(true);

    for (const change of changes.filter(change => change.description.includes('allowed origins'))) {
      const result = change.apply();
      expect(result.ok).toBe(true);
    }

    const updated = JSON.parse(readFileSync(path.join(tempHome, '.openclaw', 'openclaw.json'), 'utf8'));
    expect(updated.gateway.controlUi.allowedOrigins).toEqual(expect.arrayContaining([
      'http://localhost:3080',
      `http://${EXAMPLE_TS_IPV4}:3080`,
      `https://${EXAMPLE_TS_DNS}`,
    ]));
    expect(updated.gateway.controlUi.allowedOrigins).not.toContain(`  http://${EXAMPLE_TS_IPV4}:3080  `);
  });
});
