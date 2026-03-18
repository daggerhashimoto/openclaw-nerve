/**
 * Prerequisite checker — verifies Node.js version, npm, ffmpeg, openssl.
 */

import { execSync } from 'node:child_process';
import { success, warn, fail } from './banner.js';
import { getTailscaleState, type TailscaleState } from './tailscale.js';

export interface PrereqResult {
  nodeOk: boolean;
  nodeVersion: string;
  npmOk: boolean;
  ffmpegOk: boolean;
  opensslOk: boolean;
  tailscaleOk: boolean;
  tailscaleIp: string | null;
  tailscale: TailscaleState;
}

/** Check all prerequisites and print results. */
export function checkPrerequisites(opts?: { quiet?: boolean }): PrereqResult {
  const quiet = opts?.quiet ?? false;

  if (!quiet) console.log('  Checking prerequisites...');

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  const nodeOk = nodeMajor >= 22;

  if (!quiet) {
    if (nodeOk) success(`Node.js ${nodeVersion} (≥22 required)`);
    else fail(`Node.js ${nodeVersion} — version 22 or later is required`);
  }

  const npmOk = commandExists('npm');
  if (!quiet) {
    if (npmOk) success('npm available');
    else fail('npm not found');
  }

  const ffmpegOk = commandExists('ffmpeg');
  if (!quiet) {
    if (ffmpegOk) success('ffmpeg found (optional, for Qwen TTS)');
    else warn('ffmpeg not found (optional — needed for Qwen TTS WAV→MP3)');
  }

  const opensslOk = commandExists('openssl');
  if (!quiet) {
    if (opensslOk) success('openssl found (for HTTPS cert generation)');
    else warn('openssl not found (optional — needed for self-signed HTTPS certs)');
  }

  const tailscale = getTailscaleState();
  const tailscaleOk = tailscale.installed;
  const tailscaleIp = tailscale.ipv4;
  if (!quiet && tailscaleOk) {
    if (tailscaleIp) success(`Tailscale detected (${tailscaleIp})`);
    else if (tailscale.authenticated && tailscale.dnsName) success(`Tailscale detected (${tailscale.dnsName})`);
    else warn('Tailscale installed but not connected');
  }

  return { nodeOk, nodeVersion, npmOk, ffmpegOk, opensslOk, tailscaleOk, tailscaleIp, tailscale };
}

/** Check if a command exists on the system. */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
