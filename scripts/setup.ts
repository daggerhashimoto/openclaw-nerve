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

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { detectGatewayConfig, getEnvGatewayToken, restartGateway, approveAllPendingDevices, detectNeededConfigChanges, type ConfigChange } from './lib/gateway-detect.js';

const PROJECT_ROOT = resolve(process.cwd());
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const TOTAL_SECTIONS = 6;

const args = process.argv.slice(2);
const isHelp = args.includes('--help') || args.includes('-h');
const isCheck = args.includes('--check');
const isDefaults = args.includes('--defaults');

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

function computeGatewayOrigins(config: EnvConfig, accessMode: string): {
  nerveOrigin?: string;
  nerveHttpsOrigin?: string;
} {
  if (accessMode === 'local') return {};

  const nervePort = config.PORT || DEFAULTS.PORT;
  let accessIp = config.HOST === '0.0.0.0'
    ? (config.ALLOWED_ORIGINS?.split(',')[0]?.trim()?.replace(/^https?:\/\//, '').replace(/:\d+$/, '') || '0.0.0.0')
    : (config.HOST || 'localhost');

  if (accessIp === '0.0.0.0') {
    accessIp = detectPrimaryIpv4() || '';
  }

  // If we couldn't resolve a usable IP, skip origin generation
  if (!accessIp || accessIp === '0.0.0.0') {
    return {};
  }

  const nerveOrigin = `http://${accessIp}:${nervePort}`;
  const sslPort = config.SSL_PORT;
  const nerveHttpsOrigin = sslPort ? `https://${accessIp}:${sslPort}` : undefined;

  return { nerveOrigin, nerveHttpsOrigin };
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
        const approved = approveAllPendingDevices();
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

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (isHelp) {
    console.log(`
  Usage: npm run setup [options]

  Options:
    --check      Validate existing .env config and test gateway connection
    --defaults   Non-interactive setup using auto-detected values
    --help, -h   Show this help message

  The setup wizard guides you through 6 steps:
    1. Gateway Connection — connect to your OpenClaw gateway
    2. Agent Identity     — set your agent's display name
    3. Access Mode        — local, Tailscale, LAN, or custom
    4. Authentication     — password protection (network mode)
    5. TTS Configuration  — optional text-to-speech API keys
    6. Advanced Settings  — custom file paths (most users skip this)

  Examples:
    npm run setup               # Interactive setup
    npm run setup -- --check    # Validate existing config
    npm run setup -- --defaults # Auto-configure with detected values
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
    await runDefaults(existing);
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

  printSummary(config);

  // When invoked from install.sh, build is already done — skip misleading "next steps"
  if (!process.env.NERVE_INSTALLER) {
    printNextSteps(config);
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

  // Determine default token (priority: existing > env > detected)
  const defaultToken = existing.GATEWAY_TOKEN || envToken || detected.token || '';
  const defaultUrl = existing.GATEWAY_URL || detected.url || DEFAULTS.GATEWAY_URL;

  if (detected.token && !existing.GATEWAY_TOKEN) {
    success('Auto-detected gateway token from ~/.openclaw/openclaw.json');
  }
  if (envToken && !existing.GATEWAY_TOKEN && !detected.token) {
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
    const useDetected = await confirm({
    theme: promptTheme,
      message: `Use detected token (${defaultToken})?`,
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
  const gwTest = await testGatewayConnection(config.GATEWAY_URL!);
  if (gwTest.ok) {
    console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${gwTest.message}`);
    dim('  Start it with: openclaw gateway start');
    const proceed = await confirm({
    theme: promptTheme,
      message: 'Gateway is unreachable. Continue with this URL anyway?',
      default: false,
    });
    if (!proceed) {
      console.log('\n  Start your gateway with: \x1b[36mopenclaw gateway start\x1b[0m');
      console.log('  Then re-run: \x1b[36mnpm run setup\x1b[0m\n');
      process.exit(1);
    }
  }

  // ── 2/5: Agent Identity ──────────────────────────────────────────

  section(2, TOTAL_SECTIONS, 'Agent Identity');

  config.AGENT_NAME = await input({
    theme: promptTheme,
    message: 'Agent display name',
    default: existing.AGENT_NAME || DEFAULTS.AGENT_NAME,
  });

  // ── 3/5: Access Mode ──────────────────────────────────────────────

  section(3, TOTAL_SECTIONS, 'How will you access Nerve?');

  // Build access mode choices dynamically
  type AccessMode = 'local' | 'tailscale' | 'network' | 'custom';
  const accessChoices: { name: string; value: AccessMode; description: string }[] = [
    { name: 'This machine only (localhost)', value: 'local', description: 'Safest — only accessible from this computer' },
  ];
  if (prereqs.tailscaleIp) {
    accessChoices.push({
      name: `Via Tailscale (${prereqs.tailscaleIp})`,
      value: 'tailscale',
      description: 'Access from any device on your Tailscale network — secure, no port forwarding needed',
    });
  }
  accessChoices.push(
    { name: 'From other devices on my network', value: 'network', description: 'Opens to LAN — you may need to configure your firewall' },
    { name: 'Custom setup (I know what I\'m doing)', value: 'custom', description: 'Manual port, bind address, HTTPS, CORS configuration' },
  );

  const accessMode = await select<AccessMode>({
    theme: promptTheme,
    message: 'How will you connect to Nerve?',
    choices: accessChoices,
  });

  const port = existing.PORT || DEFAULTS.PORT;
  config.PORT = port;

  // Helper: offer HTTPS setup for non-localhost access modes (voice input needs secure context)
  async function offerHttpsSetup(remoteIp: string): Promise<void> {
    console.log('');
    warn('Voice input (microphone) requires HTTPS on non-localhost connections.');
    dim('Browsers block microphone access over plain HTTP for security.');
    console.log('');

    const enableHttps = await confirm({
      theme: promptTheme,
      message: 'Enable HTTPS? (recommended for voice input)',
      default: true,
    });

    if (enableHttps) {
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
        warn('openssl not found — cannot generate self-signed certificate');
        dim('Install openssl and run: mkdir -p certs && openssl req -x509 -newkey rsa:2048 \\');
        dim('  -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"');
      }

      if (certsReady) {
        const sslPort = existing.SSL_PORT || DEFAULTS.SSL_PORT;
        config.SSL_PORT = sslPort;
        // Add HTTPS origins to CORS and CSP
        const httpsUrl = `https://${remoteIp}:${sslPort}`;
        const existingOrigins = config.ALLOWED_ORIGINS || '';
        config.ALLOWED_ORIGINS = existingOrigins ? `${existingOrigins},${httpsUrl}` : httpsUrl;
        const existingCsp = config.CSP_CONNECT_EXTRA || '';
        config.CSP_CONNECT_EXTRA = existingCsp
          ? `${existingCsp} ${httpsUrl} wss://${remoteIp}:${sslPort}`
          : `${httpsUrl} wss://${remoteIp}:${sslPort}`;
        success(`HTTPS will be available at ${httpsUrl}`);
        dim('Note: Self-signed certs will show a browser warning on first visit — click "Advanced" → "Proceed"');
      } else {
        warn('HTTPS disabled — voice input will only work on localhost');
      }
    } else {
      dim('Voice input will only work when accessing Nerve from localhost');
    }
  }

  if (accessMode === 'local') {
    config.HOST = '127.0.0.1';
    success(`Nerve will be available at http://localhost:${port}`);

  } else if (accessMode === 'tailscale') {
    config.HOST = '0.0.0.0';
    const tsIp = prereqs.tailscaleIp!;
    const tsUrl = `http://${tsIp}:${port}`;
    config.ALLOWED_ORIGINS = tsUrl;
    config.WS_ALLOWED_HOSTS = tsIp;
    config.CSP_CONNECT_EXTRA = `${tsUrl} ws://${tsIp}:${port}`;
    success(`Nerve will be available at ${tsUrl}`);
    dim('Accessible from any device on your Tailscale network');
    await offerHttpsSetup(tsIp);

  } else if (accessMode === 'network') {
    config.HOST = '0.0.0.0';
    // Auto-detect LAN IP
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
    const lanUrl = `http://${ip}:${port}`;
    config.ALLOWED_ORIGINS = lanUrl;
    config.WS_ALLOWED_HOSTS = ip;
    config.CSP_CONNECT_EXTRA = `${lanUrl} ws://${ip}:${port}`;
    success(`Nerve will be available at ${lanUrl}`);
    dim('Make sure your firewall allows traffic on port ' + port);
    dim('Need access from multiple devices? Add more origins to ALLOWED_ORIGINS in .env');
    await offerHttpsSetup(ip);

  } else {
    // Custom — full manual control
    const portStr = await input({
    theme: promptTheme,
      message: 'HTTP port',
      default: existing.PORT || DEFAULTS.PORT,
      validate: (val) => {
        const n = parseInt(val, 10);
        if (!isValidPort(n)) return 'Please enter a valid port (1–65535)';
        return true;
      },
    });
    config.PORT = portStr;

    config.HOST = await input({
    theme: promptTheme,
      message: 'Bind address (127.0.0.1 = local only, 0.0.0.0 = all interfaces)',
      default: existing.HOST || DEFAULTS.HOST,
    });

    // HTTPS
    const enableHttps = await confirm({
    theme: promptTheme,
      message: 'Enable HTTPS? (needed for microphone access over network)',
      default: false,
    });

    if (enableHttps) {
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
        warn('openssl not found — cannot generate self-signed certificate');
        dim('Install openssl and run: mkdir -p certs && openssl req -x509 -newkey rsa:2048 \\');
        dim('  -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"');
      }

      if (certsReady) {
        config.SSL_PORT = await input({
    theme: promptTheme,
          message: 'SSL port',
          default: existing.SSL_PORT || DEFAULTS.SSL_PORT,
          validate: (val) => {
            const n = parseInt(val, 10);
            if (!isValidPort(n)) return 'Please enter a valid port (1–65535)';
            if (n === parseInt(config.PORT || DEFAULTS.PORT, 10)) return 'SSL port must differ from HTTP port';
            return true;
          },
        });
        // Add HTTPS/WSS origins to CORS and CSP when bound to a non-loopback address
        const customHost = config.HOST || DEFAULTS.HOST;
        if (customHost !== '127.0.0.1' && customHost !== 'localhost' && customHost !== '::1') {
          const httpsUrl = `https://${customHost}:${config.SSL_PORT}`;
          config.ALLOWED_ORIGINS = config.ALLOWED_ORIGINS
            ? `${config.ALLOWED_ORIGINS},${httpsUrl}`
            : httpsUrl;
          config.CSP_CONNECT_EXTRA = config.CSP_CONNECT_EXTRA
            ? `${config.CSP_CONNECT_EXTRA} ${httpsUrl} wss://${customHost}:${config.SSL_PORT}`
            : `${httpsUrl} wss://${customHost}:${config.SSL_PORT}`;
        }
      } else {
        warn('HTTPS disabled — no certificates available');
        dim('You can generate certs manually and add SSL_PORT to .env later');
      }
    }
  }

  // ── Gateway config updates ─────────────────────────────────────────

  const { nerveOrigin, nerveHttpsOrigin } = computeGatewayOrigins(config, accessMode);

  const neededChanges = detectNeededConfigChanges({
    nerveOrigin,
    nerveHttpsOrigin,
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
          dim('  • Cron tools: add "cron" to gateway.tools.allow in ~/.openclaw/openclaw.json');
        } else if (change.id === 'allowed-origins' && nerveOrigin) {
          dim(`  • Origins: add ${nerveOrigin} to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json`);
        } else if (change.id === 'allowed-origins-https' && nerveHttpsOrigin) {
          dim(`  • Origins: add ${nerveHttpsOrigin} to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json`);
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

    // Test connectivity
    process.stdout.write('  Testing gateway connection... ');
    const gwTest = await testGatewayConnection(gwUrl);
    if (gwTest.ok) {
      console.log(`\x1b[32m✓\x1b[0m ${gwTest.message}`);
    } else {
      console.log(`\x1b[33m⚠\x1b[0m ${gwTest.message}`);
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

async function runDefaults(existing: EnvConfig): Promise<void> {
  console.log('');
  info('Non-interactive mode — using defaults where possible');
  console.log('');

  const config: EnvConfig = { ...existing };

  // Try to auto-detect gateway token
  if (!config.GATEWAY_TOKEN) {
    const detected = detectGatewayConfig();
    const envToken = getEnvGatewayToken();
    const token = envToken || detected.token;

    if (token) {
      config.GATEWAY_TOKEN = token;
      success('Auto-detected gateway token');
    } else {
      fail('GATEWAY_TOKEN is required but could not be auto-detected');
      console.log('  Set OPENCLAW_GATEWAY_TOKEN in your environment, or run setup interactively.');
      console.log('');
      process.exit(1);
    }
  }

  // Apply defaults for everything else
  if (!config.GATEWAY_URL) config.GATEWAY_URL = DEFAULTS.GATEWAY_URL;
  if (!config.AGENT_NAME) config.AGENT_NAME = DEFAULTS.AGENT_NAME;
  if (!config.PORT) config.PORT = DEFAULTS.PORT;
  if (!config.HOST) config.HOST = DEFAULTS.HOST;

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

  // Write
  if (existsSync(ENV_PATH)) {
    const backupPath = backupExistingEnv(ENV_PATH);
    info(`Previous config backed up to ${backupPath.replace(PROJECT_ROOT + '/', '')}`);
  }
  writeEnvFile(ENV_PATH, config);

  success('Configuration written to .env');
  printSummary(config);

  // Apply all gateway config patches silently (non-interactive = implicit consent)
  const defaultsAccessMode = isLoopback(config.HOST || '') ? 'local' : 'network';
  const { nerveOrigin, nerveHttpsOrigin } = computeGatewayOrigins(config, defaultsAccessMode);

  const changes = detectNeededConfigChanges({
    nerveOrigin,
    nerveHttpsOrigin,
    gatewayToken: config.GATEWAY_TOKEN,
  });

  if (changes.length > 0) {
    await applyConfigChanges(changes);
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
