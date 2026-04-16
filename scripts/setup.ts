/**
 * Interactive setup wizard for Nerve.
 * Guides users through first-time configuration.
 *
 * Usage:
 *   npm run setup               # Interactive setup
 *   npm run setup -- --check    # Validate existing config
 *   npm run setup -- --defaults # Non-interactive with defaults
 */

/** Mask a token for display, with a guard for short tokens. */
// Show token in prompts so users can verify what they entered

import { existsSync, readdirSync, mkdirSync, copyFileSync, lstatSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { input, password, confirm, select } from '@inquirer/prompts';
import { printBanner, section, success, warn, fail, info, dim, promptTheme } from './lib/banner.js';
import { checkPrerequisites, type PrereqResult } from './lib/prereq-check.js';
import {
  isValidUrl,
  isValidPort,
  testGatewayConnection,
  isValidOpenAIKey,
  isValidReplicateToken,
} from './lib/validators.js';
import {
  writeEnvFile,
  backupExistingEnv,
  loadExistingEnv,
  cleanupTmp,
  DEFAULTS,
  type EnvConfig,
} from './lib/env-writer.js';
import { generateSelfSignedCert } from './lib/cert-gen.js';
import { detectGatewayConfig, getEnvGatewayToken, chooseSetupGatewayToken, restartGateway, approvePendingNerveDevice, detectNeededConfigChanges, type ConfigChange } from './lib/gateway-detect.js';
import { applyAccessPlanToConfig, buildAccessPlan, type InstallerAccessProfile } from './lib/access-plan.js';
import { getTailscaleState, type TailscaleState } from './lib/tailscale.js';
import { detectAgentDisplayNameDefault } from './lib/agent-name-default.js';
import { printDeploymentGuides, shouldPrintDeploymentGuides } from './lib/deployment-guides.js';

const PROJECT_ROOT = resolve(process.cwd());
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const SKILLS_SRC = resolve(PROJECT_ROOT, 'skills');
const SKILLS_DEST = resolve(homedir(), '.openclaw', 'workspace', 'skills');
const TOTAL_SECTIONS = 6;

const args = process.argv.slice(2);
const isHelp = args.includes('--help') || args.includes('-h');
const isCheck = args.includes('--check');
const isDefaults = args.includes('--defaults');

type AccessMode = 'local' | 'network' | 'custom' | 'tailscale-ip' | 'tailscale-serve';

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function normalizeAccessMode(value?: string | null): AccessMode | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'tailscale') return 'tailscale-ip';

  if (normalized === 'local' || normalized === 'network' || normalized === 'custom' || normalized === 'tailscale-ip' || normalized === 'tailscale-serve') {
    return normalized;
  }

  fail(`Invalid --access-mode value: ${value}`);
  console.log('  Supported values: local, network, custom, tailscale-ip, tailscale-serve');
  process.exit(1);
}

const requestedAccessMode = normalizeAccessMode(getArgValue('--access-mode'));

function detectPrimaryIpv4(): string | null {
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.family === 'IPv4') return addr.address;
    }
  }
  return null;
}

/** Check whether a host string is a loopback address (IPv4, IPv6, or localhost). */
function isLoopback(host: string): boolean {
  return !host || host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveTimer => setTimeout(resolveTimer, ms));
}

/**
 * Apply a list of config changes, restart gateway if needed, and optionally approve pending devices.
 * Shared between interactive and defaults flows to avoid duplication.
 */
async function applyConfigChanges(changes: ConfigChange[]): Promise<void> {
  let needsRestart = false;
  let deviceScopeFixFailed = false;
  let shouldApprovePending = false;

  for (const change of changes) {
    if (change.id === 'pre-pair' && deviceScopeFixFailed) {
      warn('Skipping pre-pair because device scope fix failed');
      continue;
    }

    const result = change.apply();
    if (result.ok) {
      success(result.message);
      if (result.needsRestart) needsRestart = true;
      if (change.id === 'device-scopes' || change.id === 'pre-pair') {
        shouldApprovePending = true;
      }
    } else {
      warn(result.message);
      if (change.id === 'device-scopes') {
        deviceScopeFixFailed = true;
      }
    }
  }

  if (needsRestart) {
    dim('Restarting gateway to apply changes...');
    const restart = restartGateway();
    if (restart.ok) {
      await new Promise(r => setTimeout(r, 3000));
      if (shouldApprovePending) {
        const approved = approvePendingNerveDevice();
        if (approved.ok && approved.approved > 0) {
          success(approved.message);
        } else if (!approved.ok) {
          warn(approved.message);
        }
      }
      success('Gateway configuration updated');
    } else {
      warn(restart.message);
    }
  }
}

// ── Ctrl+C handler ───────────────────────────────────────────────────

process.on('SIGINT', () => {
  cleanupTmp(ENV_PATH);
  console.log('\n\n  Setup cancelled.\n');
  process.exit(130);
});

// ── Skill installation ───────────────────────────────────────────────

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = lstatSync(srcPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function installBundledSkills(): void {
  if (!existsSync(SKILLS_SRC)) return;

  let installed = 0;
  let entries: string[];
  try {
    entries = readdirSync(SKILLS_SRC);
  } catch {
    return;
  }

  for (const skillName of entries) {
    try {
      const skillSrc = join(SKILLS_SRC, skillName);
      if (!lstatSync(skillSrc).isDirectory()) continue;
      if (!existsSync(join(skillSrc, 'SKILL.md'))) continue;

      const skillDest = join(SKILLS_DEST, skillName);
      copyDirSync(skillSrc, skillDest);
      installed++;
    } catch (err) {
      warn(`Failed to install skill "${skillName}": ${(err as Error).message}`);
    }
  }

  if (installed > 0) {
    success(`Installed ${installed} bundled skill${installed > 1 ? 's' : ''} to ${SKILLS_DEST}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (isHelp) {
    console.log(`
  Usage: npm run setup [options]

  Options:
    --check                   Validate existing .env config and test gateway connection
    --defaults                Non-interactive setup using auto-detected values
    --access-mode <mode>      Explicit non-interactive access mode
    --help, -h                Show this help message

  Access modes:
    local             Localhost only
    network           LAN-reachable
    custom            Manual bind and HTTPS choices
    tailscale-ip      Direct tailnet IP access
    tailscale-serve   Loopback + Tailscale Serve hostname

  The setup wizard guides you through 6 steps:
    1. Gateway Connection — connect to your OpenClaw gateway
    2. Agent Identity     — set your agent's display name
    3. Access Mode        — local, Tailscale IP, Tailscale Serve, LAN, or custom
    4. Authentication     — password protection (network mode)
    5. TTS Configuration  — optional text-to-speech API keys
    6. Advanced Settings  — custom file paths (most users skip this)

  Examples:
    npm run setup                                     # Interactive setup
    npm run setup -- --check                          # Validate existing config
    npm run setup -- --defaults                       # Auto-configure with detected values
    npm run setup -- --defaults --access-mode tailscale-serve
`);
    return;
  }

  printBanner(); // no-ops when NERVE_INSTALLER is set

  // Clean up stale .env.tmp from previous interrupted runs
  cleanupTmp(ENV_PATH);

  // Prerequisite checks (skip verbose output when called from installer — already checked)
  const prereqs = checkPrerequisites({ quiet: !!process.env.NERVE_INSTALLER });
  if (!prereqs.nodeOk) {
    console.log('');
    fail('Node.js ≥ 22 is required. Please upgrade and try again.');
    process.exit(1);
  }

  // Load existing config as defaults
  const hasExisting = existsSync(ENV_PATH);
  const existing: EnvConfig = hasExisting ? loadExistingEnv(ENV_PATH) : {};

  if (hasExisting) {
    info('Found existing .env configuration');
  } else {
    info('No existing .env found — starting fresh setup');
  }

  // --check mode: validate and exit
  if (isCheck) {
    await runCheck(existing);
    return;
  }

  // --defaults mode: non-interactive
  if (isDefaults) {
    await runDefaults(existing, prereqs);
    return;
  }

  // If .env exists, ask whether to update or start fresh
  // (Skip this when called from install.sh — the installer already asked)
  if (hasExisting && existing.GATEWAY_TOKEN && !process.env.NERVE_INSTALLER) {
    const action = await select({
    theme: promptTheme,
      message: 'What would you like to do?',
      choices: [
        { name: 'Update existing configuration', value: 'update' },
        { name: 'Start fresh', value: 'fresh' },
        { name: 'Cancel', value: 'cancel' },
      ],
    });
    if (action === 'cancel') {
      console.log('\n  Setup cancelled.\n');
      return;
    }
    if (action === 'fresh') {
      Object.keys(existing).forEach((k) => delete (existing as Record<string, unknown>)[k]);
    }
  }

  // Run interactive setup
  const config = await collectInteractive(existing, prereqs);

  // Write .env
  if (hasExisting) {
    const backupPath = backupExistingEnv(ENV_PATH);
    info(`Previous config backed up to ${backupPath.replace(PROJECT_ROOT + '/', '')}`);
  }
  writeEnvFile(ENV_PATH, config);

  console.log('');
  success('Configuration written to .env');

  // Install bundled agent skills
  installBundledSkills();

  printSummary(config);

  // When invoked from install.sh, build is already done — skip misleading "next steps"
  if (!process.env.NERVE_INSTALLER) {
    printNextSteps(config);
    printDeploymentGuides();
  }
}

// ── Interactive setup ────────────────────────────────────────────────

async function collectInteractive(
  existing: EnvConfig,
  prereqs: PrereqResult,
): Promise<EnvConfig> {
  const config: EnvConfig = { ...existing };

  // ── 1/5: Gateway Connection ──────────────────────────────────────

  section(1, TOTAL_SECTIONS, 'Gateway Connection');
  dim('Nerve connects to your OpenClaw gateway.');
  dim('Make sure the gateway is running before continuing.');
  console.log('');

  // Auto-detect gateway config
  const detected = detectGatewayConfig();
  const envToken = getEnvGatewayToken();
  const tokenChoice = chooseSetupGatewayToken({
    existingToken: existing.GATEWAY_TOKEN,
    detectedToken: detected.token,
    envToken,
  });

  const defaultToken = tokenChoice.token || '';
  const defaultUrl = existing.GATEWAY_URL || detected.url || DEFAULTS.GATEWAY_URL;

  if (tokenChoice.source === 'detected') {
    success('Auto-detected gateway token from local gateway config');
  }
  if (tokenChoice.source === 'env') {
    success('Found OPENCLAW_GATEWAY_TOKEN in environment');
  }

  config.GATEWAY_URL = await input({
    theme: promptTheme,
    message: 'Gateway URL',
    default: defaultUrl,
    validate: (val) => {
      if (!isValidUrl(val)) return 'Please enter a valid HTTP(S) URL';
      return true;
    },
  });

  // If we have an auto-detected token, offer to use it
  if (defaultToken && !existing.GATEWAY_TOKEN) {
    const tokenLabel = tokenChoice.source === 'env' ? 'environment token' : 'detected token';
    const useDetected = await confirm({
    theme: promptTheme,
      message: `Use ${tokenLabel} (${defaultToken})?`,
      default: true,
    });
    if (useDetected) {
      config.GATEWAY_TOKEN = defaultToken;
    } else {
      config.GATEWAY_TOKEN = await password({
    theme: promptTheme,
        message: 'Gateway Auth Token (required)',
        validate: (val) => {
          if (!val || !val.trim()) return 'Gateway token is required';
          return true;
        },
      });
    }
  } else if (existing.GATEWAY_TOKEN) {
    // Existing token — offer to keep it
    const keepExisting = await confirm({
    theme: promptTheme,
      message: `Keep existing gateway token (${existing.GATEWAY_TOKEN})?`,
      default: true,
    });
    if (keepExisting) {
      config.GATEWAY_TOKEN = existing.GATEWAY_TOKEN;
    } else {
      config.GATEWAY_TOKEN = await password({
    theme: promptTheme,
        message: 'Gateway Auth Token (required)',
        validate: (val) => {
          if (!val || !val.trim()) return 'Gateway token is required';
          return true;
        },
      });
    }
  } else {
    dim('Find your token in ~/.openclaw/openclaw.json or run: openclaw gateway status');
    config.GATEWAY_TOKEN = await password({
    theme: promptTheme,
      message: 'Gateway Auth Token (required)',
      validate: (val) => {
        if (!val || !val.trim()) return 'Gateway token is required';
        return true;
      },
    });
  }

  // Test connection
  const rail = `  \x1b[2m│\x1b[0m`;
  const testPrefix = process.env.NERVE_INSTALLER ? `${rail}  ` : '  ';
  process.stdout.write(`${testPrefix}Testing connection... `);
  const gwTest = await testGatewayConnection(config.GATEWAY_URL!, config.GATEWAY_TOKEN);
  if (gwTest.ok) {
    console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
    dim('  Start it with: openclaw gateway start');
    console.log('\n  Setup could not verify your gateway token. Fix the gateway or token, then re-run setup.\n');
    process.exit(1);
  }

  // ── 2/5: Agent Identity ──────────────────────────────────────────

  section(2, TOTAL_SECTIONS, 'Agent Identity');

  config.AGENT_NAME = await input({
    theme: promptTheme,
    message: 'Agent display name',
    default: detectAgentDisplayNameDefault(existing.AGENT_NAME, DEFAULTS.AGENT_NAME),
  });

  // ── 3/5: Access Mode ──────────────────────────────────────────────

  section(3, TOTAL_SECTIONS, 'How will you access Nerve?');

  const accessChoices: { name: string; value: AccessMode; description: string }[] = [
    { name: 'This machine only (localhost)', value: 'local', description: 'Safest, only accessible from this computer' },
    {
      name: prereqs.tailscale.ipv4 ? `Via Tailscale tailnet IP (${prereqs.tailscale.ipv4})` : 'Via Tailscale tailnet IP',
      value: 'tailscale-ip',
      description: prereqs.tailscale.installed
        ? 'Direct access from other devices on your tailnet'
        : 'Requires Tailscale on this machine',
    },
    {
      name: prereqs.tailscale.dnsName ? `Via Tailscale Serve (${prereqs.tailscale.dnsName})` : 'Via Tailscale Serve',
      value: 'tailscale-serve',
      description: 'Private by default, Nerve stays on 127.0.0.1 and is exposed through *.ts.net',
    },
    { name: 'From other devices on my network', value: 'network', description: 'Opens to LAN, you may need to configure your firewall' },
    { name: 'Custom setup (I know what I\'m doing)', value: 'custom', description: 'Manual port, bind address, HTTPS, CORS configuration' },
  ];

  const accessMode = await select<AccessMode>({
    theme: promptTheme,
    message: 'How will you connect to Nerve?',
    choices: accessChoices,
  });

  let port = existing.PORT || DEFAULTS.PORT;
  config.PORT = port;
  let sslPort: string | undefined;
  let accessPlan = buildAccessPlan({ profile: 'local', port });
  let tailscaleState: TailscaleState = prereqs.tailscale;

  function printFollowUpSteps(steps: string[]): void {
    if (steps.length === 0) return;
    for (const step of steps) {
      dim(`  • ${step}`);
    }
  }

  async function offerHttpsSetup(remoteHost: string): Promise<string | undefined> {
    console.log('');
    warn('Voice input (microphone) requires HTTPS on non-localhost connections.');
    dim('Browsers block microphone access over plain HTTP for security.');
    console.log('');

    const enableHttps = await confirm({
      theme: promptTheme,
      message: 'Enable HTTPS? (recommended for voice input)',
      default: true,
    });

    if (!enableHttps) {
      dim('Voice input will only work when accessing Nerve from localhost');
      return undefined;
    }

    let certsReady = false;
    if (prereqs.opensslOk) {
      const certResult = generateSelfSignedCert(PROJECT_ROOT);
      if (certResult.ok) {
        success(certResult.message);
        certsReady = true;
      } else {
        fail(certResult.message);
      }
    } else {
      warn('openssl not found, cannot generate self-signed certificate');
      dim('Install openssl and run: mkdir -p certs && openssl req -x509 -newkey rsa:2048 \\');
      dim('  -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"');
    }

    if (!certsReady) {
      warn('HTTPS disabled, voice input will only work on localhost');
      return undefined;
    }

    const selectedSslPort = await input({
      theme: promptTheme,
      message: 'SSL port',
      default: existing.SSL_PORT || DEFAULTS.SSL_PORT,
      validate: (val) => {
        const n = parseInt(val, 10);
        if (!isValidPort(n)) return 'Please enter a valid port (1–65535)';
        if (n === parseInt(port, 10)) return 'SSL port must differ from HTTP port';
        return true;
      },
    });

    success(`HTTPS will be available at https://${remoteHost}:${selectedSslPort}`);
    dim('Note: Self-signed certs will show a browser warning on first visit, click "Advanced" then "Proceed"');
    return selectedSslPort;
  }

  async function ensureInteractiveTailscale(): Promise<TailscaleState> {
    let state = tailscaleState;

    if (!state.installed) {
      console.log('');
      warn('Tailscale is not installed on this machine.');
      dim('Install it first, then complete browser login with: tailscale up');
      dim('Download: https://tailscale.com/download/linux');
      console.log('\n  Re-run: \x1b[36mnpm run setup\x1b[0m\n');
      process.exit(1);
    }

    if (state.authenticated) {
      return state;
    }

    console.log('');
    warn('Tailscale is installed but not connected.');
    dim('In another terminal, start the browser URL login flow with: tailscale up');
    console.log('');

    const nextAction = await select<'wait' | 'exit'>({
      theme: promptTheme,
      message: 'How should setup continue?',
      choices: [
        { name: 'Wait and continue automatically once Tailscale is connected', value: 'wait' },
        { name: 'Exit and re-run setup later', value: 'exit' },
      ],
    });

    if (nextAction === 'exit') {
      console.log('\n  Finish login with: \x1b[36mtailscale up\x1b[0m');
      console.log('  Then re-run: \x1b[36mnpm run setup\x1b[0m\n');
      process.exit(1);
    }

    process.stdout.write('  Waiting for Tailscale login... ');
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(2000);
      state = getTailscaleState();
      if (state.authenticated) {
        tailscaleState = state;
        console.log(`\x1b[32m✓\x1b[0m ${state.dnsName || state.ipv4 || 'Connected'}`);
        return state;
      }
    }

    console.log('\x1b[31m✗\x1b[0m Timed out waiting for Tailscale login');
    dim('Finish login with: tailscale up');
    console.log('');
    process.exit(1);
  }

  if (accessMode === 'local') {
    accessPlan = buildAccessPlan({ profile: 'local', port });
    success(`Nerve will be available at http://localhost:${port}`);

  } else if (accessMode === 'tailscale-ip') {
    tailscaleState = await ensureInteractiveTailscale();
    accessPlan = buildAccessPlan({ profile: 'tailscale-ip', port, tailscale: tailscaleState });
    if (accessPlan.followUpSteps.length > 0) {
      warn('Tailscale tailnet IP access is not ready yet.');
      printFollowUpSteps(accessPlan.followUpSteps);
      console.log('');
      process.exit(1);
    }
    success(`Nerve will be available at ${accessPlan.browserOrigins[0]}`);
    dim('Accessible from any device on your Tailscale network');

  } else if (accessMode === 'tailscale-serve') {
    tailscaleState = await ensureInteractiveTailscale();

    console.log('');
    const configureServe = await confirm({
      theme: promptTheme,
      message: `Configure Tailscale Serve now? (tailscale serve --bg http://127.0.0.1:${port})`,
      default: true,
    });

    if (configureServe) {
      try {
        execSync(`tailscale serve --bg http://127.0.0.1:${port}`, { stdio: 'pipe', timeout: 15000, encoding: 'utf8' });
        success(`Tailscale Serve configured for http://127.0.0.1:${port}`);
      } catch (err) {
        const execErr = err as {
          stderr?: string | Buffer;
          message?: string;
          status?: number;
          signal?: string | null;
        };
        const stderr = typeof execErr.stderr === 'string'
          ? execErr.stderr.trim()
          : Buffer.isBuffer(execErr.stderr)
            ? execErr.stderr.toString('utf8').trim()
            : '';
        const status = typeof execErr.status === 'number'
          ? ` (exit ${execErr.status})`
          : execErr.signal
            ? ` (signal ${execErr.signal})`
            : '';
        const detail = stderr || execErr.message || String(err);
        const detailWithStatus = status && !detail.includes(status.trim()) ? `${detail}${status}` : detail;
        warn(`Failed to configure Tailscale Serve automatically: ${detailWithStatus}`);
      }
    } else {
      dim(`Run later: tailscale serve --bg http://127.0.0.1:${port}`);
    }

    tailscaleState = getTailscaleState();
    accessPlan = buildAccessPlan({ profile: 'tailscale-serve', port, tailscale: tailscaleState });

    if (accessPlan.followUpSteps.length > 0) {
      console.log('');
      warn('Could not confirm a usable Tailscale Serve hostname.');
      printFollowUpSteps(accessPlan.followUpSteps);
      console.log('');

      const fallback = await select<'tailscale-ip' | 'stop'>({
        theme: promptTheme,
        message: 'How should setup continue?',
        choices: [
          { name: 'Continue with tailnet IP access instead', value: 'tailscale-ip' },
          { name: 'Stop setup and finish Tailscale Serve manually', value: 'stop' },
        ],
      });

      if (fallback === 'stop') {
        console.log('\n  Finish Tailscale Serve setup, then re-run: \x1b[36mnpm run setup\x1b[0m\n');
        process.exit(1);
      }

      accessPlan = buildAccessPlan({ profile: 'tailscale-ip', port, tailscale: tailscaleState });
      if (accessPlan.followUpSteps.length > 0) {
        warn('Tailnet IP fallback is also unavailable.');
        printFollowUpSteps(accessPlan.followUpSteps);
        console.log('');
        process.exit(1);
      }

      success(`Falling back to tailnet IP access at ${accessPlan.browserOrigins[0]}`);
    } else {
      success(`Nerve will be available at ${accessPlan.browserOrigins[0]}`);
      dim('Nerve will stay private on 127.0.0.1 and be reached through Tailscale Serve');
    }

  } else if (accessMode === 'network') {
    const detectedIp = detectPrimaryIpv4();
    const lanIp = await input({
      theme: promptTheme,
      message: 'Your LAN IP address',
      default: detectedIp || '',
      validate: (val) => {
        if (!val.trim()) return 'IP address is required for network access';
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(val.trim())) return 'Enter a valid IPv4 address';
        return true;
      },
    });
    const ip = lanIp.trim();
    sslPort = await offerHttpsSetup(ip);
    accessPlan = buildAccessPlan({ profile: 'network', port, remoteHost: ip, sslPort });
    success(`Nerve will be available at http://${ip}:${port}`);
    dim(`Make sure your firewall allows traffic on port ${port}`);
    dim('Need access from multiple devices? Add more origins to ALLOWED_ORIGINS in .env');

  } else {
    port = await input({
      theme: promptTheme,
      message: 'HTTP port',
      default: existing.PORT || DEFAULTS.PORT,
      validate: (val) => {
        const n = parseInt(val, 10);
        if (!isValidPort(n)) return 'Please enter a valid port (1–65535)';
        return true;
      },
    });
    config.PORT = port;

    const customHost = await input({
      theme: promptTheme,
      message: 'Bind address (127.0.0.1 = local only, 0.0.0.0 = all interfaces)',
      default: existing.HOST || DEFAULTS.HOST,
    });

    if (!isLoopback(customHost)) {
      sslPort = await offerHttpsSetup(customHost);
    } else {
      delete config.SSL_PORT;
    }

    accessPlan = buildAccessPlan({ profile: 'custom', port, remoteHost: customHost, sslPort });
    success(`Nerve will be available at http://${customHost}:${port}`);
  }

  delete config.ALLOWED_ORIGINS;
  delete config.CSP_CONNECT_EXTRA;
  delete config.WS_ALLOWED_HOSTS;
  delete config.SSL_PORT;
  Object.assign(config, applyAccessPlanToConfig(config, accessPlan));
  if (sslPort) config.SSL_PORT = sslPort;

  // ── Gateway config updates ─────────────────────────────────────────

  const neededChanges = detectNeededConfigChanges({
    allowedOrigins: accessPlan.gatewayAllowedOrigins,
    gatewayToken: config.GATEWAY_TOKEN,
  });

  if (neededChanges.length > 0) {
    console.log('');
    warn('Nerve needs to update your OpenClaw gateway config.');
    dim('OpenClaw config files will be updated.');
    console.log('');
    dim('The following changes are needed:');
    neededChanges.forEach((change, i) => {
      dim(`  ${i + 1}. ${change.description}`);
    });
    console.log('');

    const applyChanges = await confirm({
      theme: promptTheme,
      message: 'Apply these changes?',
      default: true,
    });

    if (applyChanges) {
      await applyConfigChanges(neededChanges);
    } else {
      warn('Skipped gateway config changes. Some features may not work:');
      for (const change of neededChanges) {
        if (change.id === 'device-scopes') {
          dim('  • Device scopes: manually fix scopes in ~/.openclaw/devices/paired.json');
        } else if (change.id === 'pre-pair') {
          dim('  • Pre-pair: run `openclaw devices approve` after starting Nerve');
        } else if (change.id === 'tools-allow') {
          dim('  • HTTP tools: add "cron", "gateway", and "sessions_spawn" to gateway.tools.allow in ~/.openclaw/openclaw.json');
        } else if (change.id.startsWith('allowed-origins')) {
          dim('  • Origins: add the required origin(s) to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json');
        }
      }
    }
  }

  // ── 4/6: Authentication ───────────────────────────────────────────

  // Always generate a session secret if not already set
  if (!config.NERVE_SESSION_SECRET) {
    config.NERVE_SESSION_SECRET = randomBytes(32).toString('hex');
  }

  const isNetworkExposed = config.HOST === '0.0.0.0';

  if (isNetworkExposed) {
    section(4, TOTAL_SECTIONS, 'Authentication');
    warn('Your access mode exposes Nerve to the network.');
    dim('Without a password, anyone on your network can access all endpoints.');
    console.log('');

    const setPassword = await confirm({
      theme: promptTheme,
      message: 'Set a password for Nerve access? (recommended)',
      default: true,
    });

    if (setPassword) {
      const pw = await password({
        theme: promptTheme,
        message: 'Enter a password',
        validate: (val) => {
          if (!val || val.trim().length < 4) return 'Password must be at least 4 characters';
          return true;
        },
      });

      const pwConfirm = await password({
        theme: promptTheme,
        message: 'Confirm password',
        validate: (val) => {
          if (val !== pw) return 'Passwords do not match';
          return true;
        },
      });

      if (pw === pwConfirm) {
        // Hash the password using scrypt (inline to avoid importing server code)
        const { scrypt } = await import('node:crypto');
        const salt = randomBytes(32);
        const hash = await new Promise<string>((resolve, reject) => {
          scrypt(pw, salt, 64, (err, derivedKey) => {
            if (err) return reject(err);
            resolve(`${salt.toString('hex')}:${derivedKey.toString('hex')}`);
          });
        });
        config.NERVE_PASSWORD_HASH = hash;
        config.NERVE_AUTH = 'true';
        success('Password set. Authentication will be enabled.');
      }
    } else {
      // No password, but still enable auth if gateway token exists
      if (config.GATEWAY_TOKEN) {
        config.NERVE_AUTH = 'true';
        success('Authentication enabled — your gateway token can be used as a password.');
      } else {
        warn('No password set and no gateway token. Authentication disabled.');
        dim('Run `npm run setup` again to set a password.');
      }
    }
  } else {
    // Localhost — skip auth setup, but preserve existing auth config
    if (existing.NERVE_AUTH) config.NERVE_AUTH = existing.NERVE_AUTH;
    if (existing.NERVE_PASSWORD_HASH) config.NERVE_PASSWORD_HASH = existing.NERVE_PASSWORD_HASH;
    if (existing.NERVE_SESSION_SECRET) config.NERVE_SESSION_SECRET = existing.NERVE_SESSION_SECRET;
    if (existing.NERVE_SESSION_TTL) config.NERVE_SESSION_TTL = existing.NERVE_SESSION_TTL;
  }

  // ── 5/6: TTS ─────────────────────────────────────────────────────

  section(5, TOTAL_SECTIONS, 'Text-to-Speech (optional)');
  dim('Edge TTS is always available (free, no API key needed).');
  dim('Add API keys below for higher-quality alternatives.');
  console.log('');

  const openaiKey = await password({
    theme: promptTheme,
    message: 'OpenAI API Key (press Enter to skip)',
  });

  if (openaiKey && openaiKey.trim()) {
    if (isValidOpenAIKey(openaiKey.trim())) {
      config.OPENAI_API_KEY = openaiKey.trim();
      success('OpenAI API key accepted (enables TTS + Whisper transcription)');
    } else {
      warn('Key doesn\'t look like a standard OpenAI key (expected sk-...)');
      const useAnyway = await confirm({
    theme: promptTheme,
        message: 'Use this key anyway?',
        default: true,
      });
      if (useAnyway) {
        config.OPENAI_API_KEY = openaiKey.trim();
      }
    }
  }

  const replicateToken = await password({
    theme: promptTheme,
    message: 'Replicate API Token (press Enter to skip)',
  });

  if (replicateToken && replicateToken.trim()) {
    if (isValidReplicateToken(replicateToken.trim())) {
      config.REPLICATE_API_TOKEN = replicateToken.trim();
      success('Replicate token accepted (enables Qwen TTS)');
      if (!prereqs.ffmpegOk) {
        warn('ffmpeg not found — Qwen TTS requires it for WAV→MP3 conversion');
      }
    } else {
      warn('Token seems too short');
      const useAnyway = await confirm({
    theme: promptTheme,
        message: 'Use this token anyway?',
        default: true,
      });
      if (useAnyway) {
        config.REPLICATE_API_TOKEN = replicateToken.trim();
      }
    }
  }

  // ── 6/6: Advanced Settings ────────────────────────────────────────

  section(6, TOTAL_SECTIONS, 'Advanced Settings (optional)');

  const configureAdvanced = await confirm({
    theme: promptTheme,
    message: 'Customize file paths? (most users should skip this)',
    default: false,
  });

  if (configureAdvanced) {
    const memPath = await input({
    theme: promptTheme,
      message: 'Custom memory file path (or Enter for default)',
      default: existing.MEMORY_PATH || '',
    });
    if (memPath.trim()) config.MEMORY_PATH = memPath.trim();

    const memDir = await input({
    theme: promptTheme,
      message: 'Custom memory directory path (or Enter for default)',
      default: existing.MEMORY_DIR || '',
    });
    if (memDir.trim()) config.MEMORY_DIR = memDir.trim();

    const sessDir = await input({
    theme: promptTheme,
      message: 'Custom sessions directory (or Enter for default)',
      default: existing.SESSIONS_DIR || '',
    });
    if (sessDir.trim()) config.SESSIONS_DIR = sessDir.trim();
  } else {
    // Preserve any existing advanced settings on update
    if (existing.MEMORY_PATH) config.MEMORY_PATH = existing.MEMORY_PATH;
    if (existing.MEMORY_DIR) config.MEMORY_DIR = existing.MEMORY_DIR;
    if (existing.SESSIONS_DIR) config.SESSIONS_DIR = existing.SESSIONS_DIR;
    if (existing.USAGE_FILE) config.USAGE_FILE = existing.USAGE_FILE;
  }

  return config;
}

// ── Summary and next steps ───────────────────────────────────────────

function printSummary(config: EnvConfig): void {
  const gwUrl = config.GATEWAY_URL || DEFAULTS.GATEWAY_URL;
  const agentName = config.AGENT_NAME || DEFAULTS.AGENT_NAME;
  const port = config.PORT || DEFAULTS.PORT;
  const sslPort = config.SSL_PORT || DEFAULTS.SSL_PORT;
  const host = config.HOST || DEFAULTS.HOST;
  const hasCerts = existsSync(resolve(PROJECT_ROOT, 'certs', 'cert.pem'));

  let ttsProvider = 'Edge (free)';
  if (config.OPENAI_API_KEY && config.REPLICATE_API_TOKEN) {
    ttsProvider = 'OpenAI + Replicate + Edge';
  } else if (config.OPENAI_API_KEY) {
    ttsProvider = 'OpenAI + Edge (fallback)';
  } else if (config.REPLICATE_API_TOKEN) {
    ttsProvider = 'Replicate + Edge (fallback)';
  }

  const hostLabel = host === '127.0.0.1' ? '127.0.0.1 (local only)' : `${host} (network)`;
  const authLabel = config.NERVE_AUTH === 'true' ? '🔒 Enabled' : 'Disabled';

  if (process.env.NERVE_INSTALLER) {
    // Rail-style summary — stays inside the installer's visual flow
    const r = `  \x1b[2m│\x1b[0m`;
    console.log('');
    console.log(`${r}  \x1b[2mGateway${' '.repeat(4)}\x1b[0m${gwUrl}`);
    console.log(`${r}  \x1b[2mAgent${' '.repeat(6)}\x1b[0m${agentName}`);
    console.log(`${r}  \x1b[2mHTTP${' '.repeat(7)}\x1b[0m:${port}`);
    if (hasCerts) {
      console.log(`${r}  \x1b[2mHTTPS${' '.repeat(6)}\x1b[0m:${sslPort}`);
    }
    console.log(`${r}  \x1b[2mTTS${' '.repeat(8)}\x1b[0m${ttsProvider}`);
    console.log(`${r}  \x1b[2mHost${' '.repeat(7)}\x1b[0m${hostLabel}`);
    console.log(`${r}  \x1b[2mAuth${' '.repeat(7)}\x1b[0m${authLabel}`);
  } else {
    // Standalone mode — boxed summary
    console.log('');
    console.log('  \x1b[2m┌─────────────────────────────────────────┐\x1b[0m');
    console.log(`  \x1b[2m│\x1b[0m  Gateway    ${gwUrl.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Agent      ${agentName.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  HTTP       :${port.padEnd(27)}\x1b[2m│\x1b[0m`);
    if (hasCerts) {
      console.log(`  \x1b[2m│\x1b[0m  HTTPS      :${sslPort.padEnd(27)}\x1b[2m│\x1b[0m`);
    }
    console.log(`  \x1b[2m│\x1b[0m  TTS        ${ttsProvider.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Host       ${hostLabel.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log(`  \x1b[2m│\x1b[0m  Auth       ${authLabel.padEnd(28)}\x1b[2m│\x1b[0m`);
    console.log('  \x1b[2m└─────────────────────────────────────────┘\x1b[0m');
  }
}

function printNextSteps(config: EnvConfig): void {
  const port = config.PORT || DEFAULTS.PORT;
  console.log('');
  console.log('  \x1b[1mNext steps:\x1b[0m');
  console.log(`    Development:   \x1b[36mnpm run dev\x1b[0m && \x1b[36mnpm run dev:server\x1b[0m`);
  console.log(`    Production:    \x1b[36mnpm run prod\x1b[0m`);
  console.log('');
  console.log(`  Open \x1b[36mhttp://localhost:${port}\x1b[0m in your browser.`);
  console.log('');
}

// ── --check mode ─────────────────────────────────────────────────────

async function runCheck(config: EnvConfig): Promise<void> {
  console.log('');
  console.log('  \x1b[1mValidating configuration...\x1b[0m');
  console.log('');

  let errors = 0;

  // Gateway token
  if (config.GATEWAY_TOKEN) {
    success('GATEWAY_TOKEN is set');
  } else {
    fail('GATEWAY_TOKEN is missing (required)');
    errors++;
  }

  // Gateway URL
  const gwUrl = config.GATEWAY_URL || DEFAULTS.GATEWAY_URL;
  if (isValidUrl(gwUrl)) {
    success(`GATEWAY_URL is valid: ${gwUrl}`);

    // Test connectivity and token validity
    process.stdout.write('  Testing gateway connection... ');
    const gwTest = await testGatewayConnection(gwUrl, config.GATEWAY_TOKEN);
    if (gwTest.ok) {
      console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
      errors++;
    }
  } else {
    fail(`GATEWAY_URL is invalid: ${gwUrl}`);
    errors++;
  }

  // Port
  const port = parseInt(config.PORT || DEFAULTS.PORT, 10);
  if (isValidPort(port)) {
    success(`PORT is valid: ${port}`);
  } else {
    fail(`PORT is invalid: ${config.PORT}`);
    errors++;
  }

  // TTS
  if (config.OPENAI_API_KEY) {
    success('OPENAI_API_KEY is set (OpenAI TTS + Whisper enabled)');
  } else {
    info('OPENAI_API_KEY not set (Edge TTS will be used as fallback)');
  }

  if (config.REPLICATE_API_TOKEN) {
    success('REPLICATE_API_TOKEN is set (Qwen TTS enabled)');
  } else {
    info('REPLICATE_API_TOKEN not set');
  }

  // Host binding
  const host = config.HOST || DEFAULTS.HOST;
  if (host === '0.0.0.0') {
    warn('HOST is 0.0.0.0 — server is accessible from the network');
  } else {
    success(`HOST: ${host}`);
  }

  // Auth
  if (config.NERVE_AUTH === 'true') {
    success('Authentication is enabled');
    if (config.NERVE_PASSWORD_HASH) {
      success('Password hash is set');
    } else if (config.GATEWAY_TOKEN) {
      info('No password hash — gateway token will be used as fallback');
    } else {
      fail('Auth is enabled but no password hash or gateway token is configured');
      errors++;
    }
    if (config.NERVE_SESSION_SECRET) {
      success('Session secret is set');
    } else {
      warn('NERVE_SESSION_SECRET not set — will be auto-generated (sessions won\'t survive restarts)');
    }
  } else if (host === '0.0.0.0') {
    warn('Authentication is DISABLED while server is network-exposed');
    dim('Run `npm run setup` to enable authentication');
  } else {
    info('Authentication disabled (localhost-only — OK)');
  }

  // HTTPS certs
  if (existsSync(resolve(PROJECT_ROOT, 'certs', 'cert.pem'))) {
    success('HTTPS certificates found at certs/');
  } else {
    info('No HTTPS certificates (HTTP only)');
  }

  console.log('');
  if (errors > 0) {
    fail(`${errors} issue(s) found. Run \x1b[36mnpm run setup\x1b[0m to fix.`);
    process.exit(1);
  } else {
    success('Configuration looks good!');
  }
  console.log('');
}

// ── --defaults mode ──────────────────────────────────────────────────

async function runDefaults(existing: EnvConfig, prereqs: PrereqResult): Promise<void> {
  console.log('');
  info('Non-interactive mode — using defaults where possible');
  console.log('');

  const config: EnvConfig = { ...existing };
  const followUpSteps: string[] = [];

  function appendFollowUp(steps: string[]): void {
    for (const step of steps) {
      if (step && !followUpSteps.includes(step)) followUpSteps.push(step);
    }
  }

  // Try to auto-detect gateway token
  if (!config.GATEWAY_TOKEN) {
    const detected = detectGatewayConfig();
    const envToken = getEnvGatewayToken();
    const tokenChoice = chooseSetupGatewayToken({
      detectedToken: detected.token,
      envToken,
    });

    if (tokenChoice.token) {
      config.GATEWAY_TOKEN = tokenChoice.token;
      success(`Auto-detected gateway token${tokenChoice.source === 'env' ? ' from environment' : ''}`);
    } else {
      fail('GATEWAY_TOKEN is required but could not be auto-detected');
      console.log('  Set OPENCLAW_GATEWAY_TOKEN in your environment, or run setup interactively.');
      console.log('');
      process.exit(1);
    }
  }

  if (!config.GATEWAY_URL) config.GATEWAY_URL = DEFAULTS.GATEWAY_URL;
  if (!config.AGENT_NAME) config.AGENT_NAME = detectAgentDisplayNameDefault(undefined, DEFAULTS.AGENT_NAME);
  if (!config.PORT) config.PORT = DEFAULTS.PORT;
  if (!config.HOST) config.HOST = DEFAULTS.HOST;

  if (requestedAccessMode) {
    let accessPlan = buildAccessPlan({
      profile: requestedAccessMode as InstallerAccessProfile,
      port: config.PORT,
      sslPort: config.SSL_PORT,
      remoteHost: !isLoopback(config.HOST || '') ? config.HOST : detectPrimaryIpv4() || config.HOST || DEFAULTS.HOST,
      tailscale: prereqs.tailscale,
    });

    if (requestedAccessMode === 'tailscale-serve' && accessPlan.followUpSteps.length > 0) {
      warn('Tailscale Serve could not be confirmed in non-interactive mode. Falling back to tailnet IP support only.');
      appendFollowUp(accessPlan.followUpSteps);
      accessPlan = buildAccessPlan({
        profile: 'tailscale-ip',
        port: config.PORT,
        tailscale: prereqs.tailscale,
      });
    }

    if ((requestedAccessMode === 'tailscale-ip' || requestedAccessMode === 'tailscale-serve') && accessPlan.followUpSteps.length > 0) {
      warn('Requested Tailscale access mode is not ready in non-interactive mode. Keeping localhost-only access for now.');
      appendFollowUp(accessPlan.followUpSteps);
      accessPlan = buildAccessPlan({ profile: 'local', port: config.PORT });
    }

    delete config.ALLOWED_ORIGINS;
    delete config.CSP_CONNECT_EXTRA;
    delete config.WS_ALLOWED_HOSTS;
    Object.assign(config, applyAccessPlanToConfig(config, accessPlan));

    success(`Using access mode: ${accessPlan.profile}`);
    if (accessPlan.browserOrigins[0]) {
      dim(`Primary origin: ${accessPlan.browserOrigins[0]}`);
    }
  }

  // Auth: auto-enable when network-exposed with gateway token, generate session secret
  if (!config.NERVE_SESSION_SECRET) {
    config.NERVE_SESSION_SECRET = randomBytes(32).toString('hex');
  }
  if (config.HOST === '0.0.0.0' && !config.NERVE_AUTH) {
    if (config.GATEWAY_TOKEN) {
      config.NERVE_AUTH = 'true';
      success('Authentication auto-enabled (gateway token can be used as password)');
    } else {
      warn('Network-exposed without authentication — consider running interactive setup');
    }
  }

  process.stdout.write('  Testing gateway connection... ');
  const gwTest = await testGatewayConnection(config.GATEWAY_URL!, config.GATEWAY_TOKEN);
  if (gwTest.ok) {
    console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
    fail('Refusing to write .env because gateway auth could not be verified.');
    console.log('');
    process.exit(1);
  }

  if (existsSync(ENV_PATH)) {
    const backupPath = backupExistingEnv(ENV_PATH);
    info(`Previous config backed up to ${backupPath.replace(PROJECT_ROOT + '/', '')}`);
  }
  writeEnvFile(ENV_PATH, config);

  success('Configuration written to .env');

  installBundledSkills();

  printSummary(config);
  if (shouldPrintDeploymentGuides({ invokedFromInstaller: process.env.NERVE_INSTALLER === '1', defaultsMode: true })) {
    printDeploymentGuides();
  }

  const changes = detectNeededConfigChanges({
    allowedOrigins: config.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
    gatewayToken: config.GATEWAY_TOKEN,
  });

  if (changes.length > 0) {
    await applyConfigChanges(changes);
  }

  if (followUpSteps.length > 0) {
    console.log('');
    warn('Additional follow-up is required:');
    for (const step of followUpSteps) {
      dim(`  • ${step}`);
    }
  }

  console.log('');
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  // ExitPromptError is thrown when user presses Ctrl+C during a prompt
  if (err?.name === 'ExitPromptError') {
    cleanupTmp(ENV_PATH);
    console.log('\n\n  Setup cancelled.\n');
    process.exit(130);
  }
  console.error('\n  Setup failed:', err.message || err);
  cleanupTmp(ENV_PATH);
  process.exit(1);
});
