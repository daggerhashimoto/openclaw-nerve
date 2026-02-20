/**
 * Claude Code usage limits — spawns Claude CLI via node-pty, sends `/usage`,
 * and parses the output.
 *
 * The flow:
 *  1. Spawn `claude` in a PTY (needed for its interactive TUI)
 *  2. Wait for the ready prompt (handling workspace trust prompts if shown)
 *  3. Send `/usage` + Enter
 *  4. Parse the ANSI-stripped output for session and weekly usage percentages
 *
 * Exported {@link getClaudeUsage} returns raw usage data consumed by the
 * `/api/claude-code-limits` route, which normalises reset timestamps.
 * @module
 */

import * as nodePty from 'node-pty';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Types ────────────────────────────────────────────────────────────

interface RawLimitWindow {
  used_percent: number;
  left_percent: number;
  resets_at: string;
}

export interface RawClaudeLimits {
  available: boolean;
  session_limit?: RawLimitWindow | null;
  weekly_limit?: RawLimitWindow | null;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Strip ANSI/OSC/CSI escape sequences and carriage returns from PTY output. */
function stripAnsi(s: string): string {
  return s
    // OSC sequences: ESC ] ... (terminated by BEL or ST)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\].*?(?:\x07|\x1B\\)/g, '')
    // CSI sequences: ESC [ <params> <intermediates> <final byte>
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    // Other two-char escape sequences (e.g. ESC =, ESC >)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B[^[\]].?/g, '')
    // Carriage returns
    .replace(/\r/g, '');
}

function resolveClaudeBin(): string {
  // Check common Claude CLI install locations in priority order.
  // The server process (especially under systemd/launchd) often has a
  // minimal PATH that doesn't include these directories.
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),           // Linux native install
    join(homedir(), '.claude', 'local', 'claude'),         // macOS native install
    '/usr/local/bin/claude',                               // Homebrew / manual
    '/opt/homebrew/bin/claude',                            // Homebrew ARM macOS
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return 'claude'; // fall back to PATH lookup
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll the buffer until `test` returns true, checking every `intervalMs`.
 * Returns true if matched, false on timeout.
 */
async function pollFor(
  getBuffer: () => string,
  test: (clean: string) => boolean,
  timeoutMs: number,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (test(stripAnsi(getBuffer()))) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** Check if the buffer contains Claude's ready prompt (❯ or >) */
function hasReadyPrompt(clean: string): boolean {
  // Claude shows ❯ (U+276F) or > when ready for input
  return clean.includes('❯') || /^>\s*$/m.test(clean);
}

/** Check if the buffer contains a workspace trust prompt */
function hasTrustPrompt(clean: string): boolean {
  const lower = clean.toLowerCase();
  return (
    lower.includes('trust this folder') ||
    lower.includes('quick safety check') ||
    lower.includes('accessing workspace')
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export async function getClaudeUsage(): Promise<RawClaudeLimits> {
  const claudeBin = resolveClaudeBin();
  let pty: nodePty.IPty | null = null;
  let buffer = '';

  try {
    // Ensure ~/.local/bin is in PATH — under systemd the default PATH is
    // minimal and Claude CLI prints a "not in PATH" warning instead of
    // starting the interactive REPL.
    const spawnEnv = { ...process.env } as Record<string, string>;
    const localBin = join(homedir(), '.local', 'bin');
    if (spawnEnv.PATH && !spawnEnv.PATH.split(':').includes(localBin)) {
      spawnEnv.PATH = `${localBin}:${spawnEnv.PATH}`;
    }

    pty = nodePty.spawn(claudeBin, [], {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd: tmpdir(),
      env: spawnEnv,
    });

    pty.onData((data: string) => {
      buffer += data;
    });

    const getBuffer = () => buffer;

    // Step 1: Wait for either a trust prompt or the ready prompt (max 15s)
    const gotInitial = await pollFor(
      getBuffer,
      (clean) => hasTrustPrompt(clean) || hasReadyPrompt(clean),
      15_000,
    );

    if (!gotInitial) {
      return { available: false, error: 'Timeout waiting for Claude to start' };
    }

    // Step 2: If trust prompt, accept it and wait for ready prompt
    if (hasTrustPrompt(stripAnsi(buffer))) {
      pty.write('\r');
      const gotReady = await pollFor(getBuffer, hasReadyPrompt, 15_000);
      if (!gotReady) {
        return { available: false, error: 'Timeout waiting for Claude after trust prompt' };
      }
    }

    // Step 3: Send /usage command
    pty.write('/usage\r');
    await sleep(1000);
    pty.write('\r'); // confirmation Enter

    // Step 4: Poll for usage data to appear (max 10s)
    const gotUsage = await pollFor(
      getBuffer,
      (clean) => /\d+%\s*used/i.test(clean) || /hit\s*your\s*limit/i.test(clean),
      10_000,
    );

    if (!gotUsage) {
      console.error('Claude usage: no usage data found in output. Buffer (stripped):', stripAnsi(buffer).slice(-2000));
      return { available: false, error: 'No usage data found in Claude output' };
    }

    // Parse the collected output
    const output = stripAnsi(buffer);

    let sessionUsed: number | null = null;
    let sessionResets: string | null = null;
    let weeklyUsed: number | null = null;
    let weeklyResets: string | null = null;

    // Panel format — may be multi-line or single-line after ANSI stripping:
    // Single: "Current session    █████  42%usedReses10:59pm (Europe/Berlin)"
    // Multi:  "Current session\n  █████  42% used\n  Resets 10:59pm"
    // Use [\s\S]*? to match across line boundaries
    const mPanelSess = output.match(
      /Current\s*session[\s\S]*?(\d+)%\s*used[\s\S]*?Rese?t?s?\s*([^\n]+)/i,
    );
    if (mPanelSess) {
      sessionUsed = parseInt(mPanelSess[1], 10);
      sessionResets = mPanelSess[2].trim();
    }

    // Weekly — same flexible matching across line boundaries
    const mPanelWeek = output.match(
      /Current\s*week(?:\s*\([^)]*\))?[\s\S]*?(\d+)%\s*used[\s\S]*?Rese?t?s?\s*([^\n]+)/i,
    );
    if (mPanelWeek) {
      weeklyUsed = parseInt(mPanelWeek[1], 10);
      weeklyResets = mPanelWeek[2].trim();
    }

    // Footer fallbacks
    for (const line of output.split('\n')) {
      const sessionMatch = line.match(/used\s*(\d+)%\s*of\s*your\s*session\s*limit.*?rese?ts?\s*([^·]+)/i);
      if (sessionMatch) {
        sessionUsed = parseInt(sessionMatch[1], 10);
        sessionResets = sessionMatch[2].trim();
      }

      const hitMatch = line.match(/hit\s*your\s*limit.*?rese?ts?\s*([^·]+)/i);
      if (hitMatch) {
        sessionUsed = 100;
        sessionResets = hitMatch[1].trim();
      }
    }

    return {
      available: sessionUsed !== null || weeklyUsed !== null,
      session_limit:
        sessionUsed !== null
          ? {
              used_percent: sessionUsed,
              left_percent: 100 - sessionUsed,
              resets_at: sessionResets!,
            }
          : null,
      weekly_limit:
        weeklyUsed !== null
          ? {
              used_percent: weeklyUsed,
              left_percent: 100 - weeklyUsed,
              resets_at: weeklyResets!,
            }
          : null,
    };
  } catch (error) {
    console.error('Error fetching Claude usage via PTY:', error);
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    if (pty) {
      try {
        pty.kill();
      } catch {
        // already dead
      }
    }
  }
}
