/**
 * Git checkout + npm install + build.
 */

import { execFileSync, execSync } from 'node:child_process';
import { EXIT_CODES, UpdateError } from './types.js';

const EXEC_TIMEOUT = 300_000; // 5 minutes
const WHISPER_FALLBACK_VERSION = '1.0.10';

/**
 * Fetch tags and checkout the target tag (detached HEAD).
 */
export function gitFetchAndCheckout(cwd: string, tag: string): void {
  try {
    execSync('git fetch --tags origin', { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT });
  } catch (err) {
    throw new UpdateError(
      `git fetch failed: ${errorMessage(err)}`,
      'update',
      EXIT_CODES.BUILD,
    );
  }

  try {
    execSync(`git checkout --force ${tag}`, { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT });
  } catch (err) {
    throw new UpdateError(
      `git checkout ${tag} failed: ${errorMessage(err)}`,
      'update',
      EXIT_CODES.BUILD,
    );
  }
}

/**
 * Checkout a local ref without fetching from remote. Used for rollback.
 */
export function gitCheckoutLocal(cwd: string, ref: string): void {
  try {
    execSync(`git checkout --force ${ref}`, { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT });
  } catch (err) {
    throw new UpdateError(
      `git checkout ${ref} failed: ${errorMessage(err)}`,
      'rollback',
      EXIT_CODES.ROLLBACK,
    );
  }
}

/**
 * Run npm install, then build client and server.
 */
export function buildProject(cwd: string): void {
  runBuildStep(cwd, 'npm install', 'npm install failed');

  // Keep updater behavior aligned with install.sh for macOS arm64 Whisper runtime.
  verifyWhisperRuntime(cwd);

  runBuildStep(cwd, 'npm run build', 'Client build failed');
  runBuildStep(cwd, 'npm run build:server', 'Server build failed');
}

function runBuildStep(cwd: string, cmd: string, label: string): void {
  try {
    execSync(cmd, { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT });
  } catch (err) {
    throw new UpdateError(
      `${label}: ${errorMessage(err)}`,
      'build',
      EXIT_CODES.BUILD,
    );
  }
}

/**
 * Verify that whisper native binary can load on macOS arm64.
 * If not, apply known-good fallback package versions and retry.
 */
function verifyWhisperRuntime(cwd: string): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;

  try {
    runWhisperProbe(cwd);
    return;
  } catch (firstErr) {
    const macMajor = detectMacMajorVersion();
    if (macMajor === null || macMajor > 14) {
      throw new UpdateError(
        `Whisper native runtime check failed: ${errorMessage(firstErr)}`,
        'build',
        EXIT_CODES.BUILD,
      );
    }
  }

  try {
    execSync(
      `npm install --no-save --force --silent @fugood/whisper.node@${WHISPER_FALLBACK_VERSION} @fugood/node-whisper-darwin-arm64@${WHISPER_FALLBACK_VERSION}`,
      { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT },
    );
  } catch (installErr) {
    throw new UpdateError(
      `Whisper fallback install failed: ${errorMessage(installErr)}`,
      'build',
      EXIT_CODES.BUILD,
    );
  }

  try {
    runWhisperProbe(cwd);
  } catch (retryErr) {
    throw new UpdateError(
      `Whisper native runtime check failed after fallback: ${errorMessage(retryErr)}`,
      'build',
      EXIT_CODES.BUILD,
    );
  }
}

function detectMacMajorVersion(): number | null {
  try {
    const version = execSync('sw_vers -productVersion', { stdio: 'pipe', timeout: 5_000 }).toString().trim();
    const major = Number(version.split('.')[0]);
    return Number.isInteger(major) ? major : null;
  } catch {
    return null;
  }
}

function runWhisperProbe(cwd: string): void {
  const probe = "import('@fugood/whisper.node').then(async (m)=>{const api=(typeof m.loadWhisperModule==='function')?m:((m.default&&typeof m.default.loadWhisperModule==='function')?m.default:null);if(!api)throw new Error('whisper.node missing loadWhisperModule export');await api.loadWhisperModule();process.exit(0);}).catch((e)=>{console.error(e?.stack||e?.message||String(e));process.exit(1);})";
  execFileSync(process.execPath, ['-e', probe], { cwd, stdio: 'pipe', timeout: EXEC_TIMEOUT });
}

function errorMessage(err: unknown): string {
  // execSync errors carry stderr with the actual useful output
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = (err as { stderr: Buffer | string }).stderr;
    const text = Buffer.isBuffer(stderr) ? stderr.toString().trim() : String(stderr).trim();
    if (text) return text;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
