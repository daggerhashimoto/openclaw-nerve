/**
 * Skills API Routes
 *
 * GET /api/skills — List all skills via `openclaw skills list --json`
 */

import { Hono } from 'hono';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile, type ExecFileException } from 'node:child_process';
import { dirname, join } from 'node:path';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { resolveOpenclawBin } from '../lib/openclaw-bin.js';
import { InvalidAgentIdError, resolveAgentWorkspace } from '../lib/agent-workspace.js';
import { config } from '../lib/config.js';

const app = new Hono();

const SKILLS_TIMEOUT_MS = 15_000;
const OPENCLAW_CONFIG_FILENAME = 'openclaw.json';

/** Ensure PATH includes the directory of the current Node binary (for #!/usr/bin/env node shims under systemd) */
const nodeDir = dirname(process.execPath);
const enrichedEnv = { ...process.env, PATH: `${nodeDir}:${process.env.PATH || ''}` };

interface SkillMissing {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

interface RawSkill {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing?: SkillMissing;
}

interface SkillsOutput {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills?: RawSkill[];
}

class SkillsRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillsRouteError';
  }
}

function extractJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new SkillsRouteError('openclaw skills list returned empty output');
  }

  // Normal case: pure JSON output.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to prelude-tolerant parsing.
  }

  // OpenClaw can print warnings before JSON.
  // Try parsing from each possible JSON structure start ({ or [).
  const startIndices: number[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{' || ch === '[') {
      startIndices.push(i);
    }
  }

  for (const start of startIndices) {
    const candidate = trimmed.slice(start).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning for the next JSON structure start.
    }
  }

  throw new SkillsRouteError('Failed to parse openclaw skills output as JSON');
}

function parseSkillsOutput(stdout: string): RawSkill[] {
  const parsed = extractJsonPayload(stdout);

  if (Array.isArray(parsed)) {
    return parsed as RawSkill[];
  }

  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SkillsOutput).skills)) {
    return (parsed as SkillsOutput).skills as RawSkill[];
  }

  throw new SkillsRouteError('Invalid openclaw skills payload: missing skills array');
}

function formatExecError(err: ExecFileException, stderr: string, commandLabel: string): string {
  if (err.code === 'ENOENT') {
    return 'openclaw CLI not found in PATH';
  }

  if (err.killed && err.signal === 'SIGTERM') {
    return `${commandLabel} timed out after ${SKILLS_TIMEOUT_MS}ms`;
  }

  const stderrLine = stderr.trim().split('\n').find(Boolean);
  if (stderrLine) {
    return `${commandLabel} failed: ${stderrLine}`;
  }

  return `${commandLabel} failed: ${err.message}`;
}

function execOpenclawCommand(args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const openclawBin = resolveOpenclawBin();
    execFile(openclawBin, args, {
      timeout: SKILLS_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      env: opts.env ?? enrichedEnv,
      cwd: opts.cwd,
    }, (err, stdout, stderr) => {
      if (err) {
        const label = `openclaw ${args.join(' ')}`;
        return reject(new SkillsRouteError(formatExecError(err, stderr, label)));
      }
      return resolve(stdout);
    });
  });
}

function getActiveOpenclawConfigPath(): string {
  const envPath = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (envPath) {
    return envPath;
  }
  return join(config.home, '.openclaw', OPENCLAW_CONFIG_FILENAME);
}

async function createScopedOpenclawEnv(workspaceRoot: string): Promise<{
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'nerve-skills-'));
  const tempConfigPath = join(tempDir, OPENCLAW_CONFIG_FILENAME);

  try {
    await fs.copyFile(getActiveOpenclawConfigPath(), tempConfigPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.writeFile(tempConfigPath, '{}\n', 'utf-8');
    } else {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw err;
    }
  }

  const scopedEnv = {
    ...enrichedEnv,
    OPENCLAW_CONFIG_PATH: tempConfigPath,
  };

  try {
    await execOpenclawCommand(['config', 'set', 'agents.defaults.workspace', workspaceRoot], {
      env: scopedEnv,
    });
  } catch (err) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw err;
  }

  return {
    env: scopedEnv,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function resolveWorkspaceCwd(workspaceRoot: string): Promise<string | undefined> {
  try {
    await fs.access(workspaceRoot);
    return workspaceRoot;
  } catch {
    return undefined;
  }
}

async function execOpenclawSkills(agentId?: string): Promise<RawSkill[]> {
  const workspace = resolveAgentWorkspace(agentId);
  const scoped = await createScopedOpenclawEnv(workspace.workspaceRoot);

  try {
    const stdout = await execOpenclawCommand(['skills', 'list', '--json'], {
      env: scoped.env,
      cwd: await resolveWorkspaceCwd(workspace.workspaceRoot),
    });
    return parseSkillsOutput(stdout);
  } finally {
    await scoped.cleanup();
  }
}

app.get('/api/skills', rateLimitGeneral, async (c) => {
  try {
    const skills = await execOpenclawSkills(c.req.query('agentId'));
    return c.json({ ok: true, skills });
  } catch (err) {
    if (err instanceof InvalidAgentIdError) {
      return c.json({ ok: false, error: err.message }, 400);
    }

    const message = err instanceof Error ? err.message : 'Failed to list skills';
    console.error('[skills] list error:', message);
    return c.json({ ok: false, error: message }, 502);
  }
});

export default app;
