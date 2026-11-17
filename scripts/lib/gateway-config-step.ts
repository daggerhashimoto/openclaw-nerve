/**
 * The setup step that brings the OpenClaw gateway config in line with Nerve.
 *
 * A gateway on this machine is patched through its local OpenClaw home and
 * restarted. A gateway on another machine is left alone: setup prints what to
 * change on that host instead, built from the same facts the local patcher uses.
 */

import { dim, success, warn } from './banner.js';
import {
  approvePendingNerveDevice,
  detectNeededConfigChanges,
  REQUIRED_HTTP_TOOLS,
  restartGateway,
  type ConfigChange,
  type GatewayTokenSource,
} from './gateway-detect.js';
import { gatewayHostLabel, type GatewayLocation } from './gateway-locality.js';

type Wait = (ms: number) => Promise<void>;

const defaultWait: Wait = ms => new Promise(resolveTimer => setTimeout(resolveTimer, ms));

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

/** "a", "a and b", "a, b, and c" */
function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// ── Manual-fix strings, shared by the skipped-changes list and the remote steps ──

export function toolsAllowHint(): string {
  const tools = joinWithAnd(REQUIRED_HTTP_TOOLS.map(tool => `"${tool}"`));
  return `HTTP tools: add ${tools} to gateway.tools.allow in ~/.openclaw/openclaw.json`;
}

export function allowedOriginsHint(origins: string[] = []): string {
  const what = origins.length > 0 ? origins.join(', ') : 'the required origin(s)';
  return `Origins: add ${what} to gateway.controlUi.allowedOrigins in ~/.openclaw/openclaw.json`;
}

/** Manual fix for a change the user declined, or null when there is nothing to say. */
export function skippedChangeHint(changeId: string): string | null {
  if (changeId === 'device-scopes') return 'Device scopes: manually fix scopes in ~/.openclaw/devices/paired.json';
  if (changeId === 'pre-pair') return 'Pre-pair: run `openclaw devices approve` after starting Nerve';
  if (changeId === 'tools-allow') return toolsAllowHint();
  if (changeId.startsWith('allowed-origins')) return allowedOriginsHint();
  return null;
}

// ── Remote gateway ───────────────────────────────────────────────────

/**
 * Origins a remote gateway must allow. The access plan's origins cover how
 * browsers reach Nerve; the loopback pair covers a browser on the Nerve host
 * and Nerve's own server-side gateway calls, which default to
 * http://127.0.0.1:<port> (see docs/DEPLOYMENT-B.md).
 */
export function remoteGatewayOrigins(planOrigins: string[] | undefined, port: string): string[] {
  return dedupe([
    ...(planOrigins ?? []),
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
}

/** The manual steps for a gateway on another machine, one per line. */
export function remoteGatewaySteps(origins: string[]): string[] {
  return [
    allowedOriginsHint(origins),
    toolsAllowHint(),
    'Restart: run `openclaw gateway restart` after saving the config',
    'Device: after starting Nerve, run `openclaw devices list`, then `openclaw devices approve <requestId>` for the Nerve request',
  ];
}

/** Why setup left the gateway alone, then where the steps go. */
export function remoteGatewayHeadline(location: GatewayLocation): [string, string] {
  const host = location.host ?? 'the gateway';
  if (location.forwarded === 'no-local-openclaw') {
    return [
      `This machine runs no OpenClaw, so the gateway at ${host} is forwarded from elsewhere (an SSH tunnel or a container) and setup did not change any OpenClaw config.`,
      'Make these changes where the gateway runs:',
    ];
  }
  if (location.forwarded === 'override') {
    return [
      `NERVE_GATEWAY_LOCATION=remote is set, so setup did not change this machine's OpenClaw config.`,
      'Make these changes where the gateway runs:',
    ];
  }
  return [
    `The gateway at ${host} is on another machine, so setup did not change any OpenClaw config.`,
    `Make these changes on ${host}:`,
  ];
}

export function printRemoteGatewaySteps(location: GatewayLocation, origins: string[]): void {
  const [headline, where] = remoteGatewayHeadline(location);
  console.log('');
  warn(headline);
  dim(where);
  for (const step of remoteGatewaySteps(origins)) {
    dim(`  • ${step}`);
  }
}

// ── Token wording ────────────────────────────────────────────────────

/**
 * Confirm prompt for a token setup found without asking. A token read from
 * this machine's OpenClaw config is labelled as such when the gateway is on
 * another machine, and the prompt then defaults to No.
 */
export function detectedTokenPrompt(opts: {
  source: GatewayTokenSource;
  token: string;
  location: GatewayLocation;
}): { message: string; default: boolean } {
  if (opts.source === 'detected' && opts.location.locality === 'remote') {
    return {
      message: `Found this machine's OpenClaw token (${opts.token}), which may not match the gateway at ${opts.location.host}. Use it anyway?`,
      default: false,
    };
  }
  const tokenLabel = opts.source === 'env' ? 'environment token' : 'detected token';
  return { message: `Use ${tokenLabel} (${opts.token})?`, default: true };
}

/** Status line for a token picked up in non-interactive mode. */
export function detectedTokenNotice(
  source: GatewayTokenSource,
  location: GatewayLocation,
): { level: 'success' | 'warn'; message: string } {
  if (source === 'detected' && location.locality === 'remote') {
    return {
      level: 'warn',
      message: `Using this machine's OpenClaw token, which may not match the gateway at ${location.host}. If the check below fails, set GATEWAY_TOKEN in .env to that gateway's token.`,
    };
  }
  return { level: 'success', message: `Auto-detected gateway token${source === 'env' ? ' from environment' : ''}` };
}

/** Where to find the token by hand when setup could not detect one. */
export function manualTokenHint(location: GatewayLocation, tokenIsSecretRef: boolean | undefined): string[] {
  if (location.locality === 'remote') {
    return [`Find the token on ${gatewayHostLabel(location)} in ~/.openclaw/openclaw.json, or run there: openclaw gateway status`];
  }
  if (tokenIsSecretRef) {
    return [
      'gateway.auth.token is stored as a secret reference, so setup cannot read it.',
      'Look for the plain value in ~/.openclaw/.env or wherever your gateway service sets it.',
    ];
  }
  return ['Find your token in ~/.openclaw/openclaw.json or run: openclaw gateway status'];
}

// ── Local gateway ────────────────────────────────────────────────────

/**
 * Apply a list of config changes, restart gateway if needed, and optionally approve pending devices.
 * Shared between interactive and defaults flows to avoid duplication.
 */
export async function applyConfigChanges(changes: ConfigChange[], opts: { wait?: Wait } = {}): Promise<void> {
  const wait = opts.wait ?? defaultWait;
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
      await wait(3000);
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

// ── The step ─────────────────────────────────────────────────────────

export interface GatewayConfigStepOptions {
  /** Where GATEWAY_URL points, from classifyGatewayUrl. */
  location: GatewayLocation;
  /** Browser origins the gateway must allow in gateway.controlUi.allowedOrigins. */
  allowedOrigins: string[] | undefined;
  gatewayToken: string | undefined;
  /** Nerve's HTTP port, for the loopback origins a remote gateway needs. */
  port: string;
  /** Interactive setup asks before applying. Without it, changes apply silently (--defaults). */
  confirm?: (message: string) => Promise<boolean>;
  wait?: Wait;
}

/**
 * Patch a local (or unknown) gateway as setup always has, or print the steps
 * for a remote one without reading, writing, or restarting anything here.
 */
export async function runGatewayConfigStep(opts: GatewayConfigStepOptions): Promise<void> {
  if (opts.location.locality === 'remote' && opts.location.host) {
    printRemoteGatewaySteps(opts.location, remoteGatewayOrigins(opts.allowedOrigins, opts.port));
    return;
  }

  const neededChanges = detectNeededConfigChanges({
    allowedOrigins: opts.allowedOrigins,
    gatewayToken: opts.gatewayToken,
  });
  if (neededChanges.length === 0) return;

  if (!opts.confirm) {
    await applyConfigChanges(neededChanges, { wait: opts.wait });
    return;
  }

  console.log('');
  warn('Nerve needs to update your OpenClaw gateway config.');
  dim('OpenClaw config files will be updated.');
  console.log('');
  dim('The following changes are needed:');
  neededChanges.forEach((change, i) => {
    dim(`  ${i + 1}. ${change.description}`);
  });
  console.log('');

  const applyChanges = await opts.confirm('Apply these changes?');

  if (applyChanges) {
    await applyConfigChanges(neededChanges, { wait: opts.wait });
  } else {
    warn('Skipped gateway config changes. Some features may not work:');
    for (const change of neededChanges) {
      const hint = skippedChangeHint(change.id);
      if (hint) dim(`  • ${hint}`);
    }
  }
}
