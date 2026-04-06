/**
 * Workspace file API Routes
 *
 * GET  /api/workspace/:key  — Read a workspace file by key
 * PUT  /api/workspace/:key  — Write a workspace file by key
 *
 * Strict allowlist of keys → files. No directory traversal.
 *
 * When the workspace directory is not locally accessible (e.g. Nerve on
 * DGX host, workspace inside OpenShell sandbox), falls back to gateway
 * RPC via `agents.files.get/set/list`.
 */

import { Hono, type Context } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readText } from '../lib/files.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { InvalidAgentIdError, resolveAgentWorkspace } from '../lib/agent-workspace.js';
import { isWorkspaceLocal } from '../lib/workspace-detect.js';
import { gatewayFilesList, gatewayFilesGet, gatewayFilesSet } from '../lib/gateway-rpc.js';

const app = new Hono();

/** Strict allowlist mapping key → filename */
const FILE_MAP: Record<string, string> = {
  soul: 'SOUL.md',
  tools: 'TOOLS.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  agents: 'AGENTS.md',
  heartbeat: 'HEARTBEAT.md',
  chatPathLinks: 'CHAT_PATH_LINKS.json',
};

function getWorkspaceRoot(agentId?: string): { agentId: string; workspaceRoot: string } {
  const workspace = resolveAgentWorkspace(agentId);
  return { agentId: workspace.agentId, workspaceRoot: workspace.workspaceRoot };
}

function handleAgentWorkspaceError(c: Context, err: unknown) {
  if (err instanceof InvalidAgentIdError) {
    return c.json({ ok: false, error: err.message }, 400);
  }
  const message = err instanceof Error ? err.message : 'Invalid workspace request';
  return c.json({ ok: false, error: message }, 500);
}

app.get('/api/workspace/:key', rateLimitGeneral, async (c) => {
  let workspace: { agentId: string; workspaceRoot: string };
  try {
    workspace = getWorkspaceRoot(c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const key = c.req.param('key');
  const filename = FILE_MAP[key];
  if (!filename) return c.json({ ok: false, error: 'Unknown file key' }, 400);

  const filePath = path.join(workspace.workspaceRoot, filename);

  // Try local first
  try {
    await fs.access(filePath);
    const content = await readText(filePath);
    return c.json({ ok: true, content });
  } catch {
    // Local failed — try gateway fallback
  }

  try {
    const file = await gatewayFilesGet(workspace.agentId, filename);
    if (file) {
      return c.json({ ok: true, content: file.content, remoteWorkspace: true });
    }
  } catch (err) {
    console.warn('[workspace] Gateway fallback failed:', (err as Error).message);
  }

  return c.json({ ok: false, error: 'File not found' }, 404);
});

app.put('/api/workspace/:key', rateLimitGeneral, async (c) => {
  let body: { content?: string; agentId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  let workspace: { agentId: string; workspaceRoot: string };
  try {
    workspace = getWorkspaceRoot(body.agentId ?? c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const key = c.req.param('key');
  const filename = FILE_MAP[key];
  if (!filename) return c.json({ ok: false, error: 'Unknown file key' }, 400);

  if (typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'Missing content field' }, 400);
  }
  if (body.content.length > 100_000) {
    return c.json({ ok: false, error: 'Content too large (max 100KB)' }, 400);
  }

  const filePath = path.join(workspace.workspaceRoot, filename);

  // Try local first
  if (await isWorkspaceLocal(workspace.workspaceRoot)) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body.content, 'utf-8');
      return c.json({ ok: true });
    } catch (err) {
      console.error('[workspace] PUT local error:', (err as Error).message);
      return c.json({ ok: false, error: 'Failed to write file' }, 500);
    }
  }

  // Gateway fallback
  try {
    await gatewayFilesSet(workspace.agentId, filename, body.content);
    return c.json({ ok: true, remoteWorkspace: true });
  } catch (err) {
    console.error('[workspace] PUT gateway error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to write file' }, 500);
  }
});

/** List available workspace file keys and their existence status */
app.get('/api/workspace', rateLimitGeneral, async (c) => {
  let workspace: { agentId: string; workspaceRoot: string };
  try {
    workspace = getWorkspaceRoot(c.req.query('agentId'));
  } catch (err) {
    return handleAgentWorkspaceError(c, err);
  }

  const files: Array<{ key: string; filename: string; exists: boolean }> = [];
  let isRemote = false;

  // Try local first
  if (await isWorkspaceLocal(workspace.workspaceRoot)) {
    for (const [key, filename] of Object.entries(FILE_MAP)) {
      const filePath = path.join(workspace.workspaceRoot, filename);
      let exists = false;
      try {
        await fs.access(filePath);
        exists = true;
      } catch {
        // not found
      }
      files.push({ key, filename, exists });
    }
  } else {
    // Gateway fallback
    isRemote = true;
    try {
      const remoteFiles = await gatewayFilesList(workspace.agentId);
      const remoteByName = new Map(remoteFiles.map((f) => [f.name, f]));

      for (const [key, filename] of Object.entries(FILE_MAP)) {
        const remote = remoteByName.get(filename);
        files.push({ key, filename, exists: !!remote && !remote.missing });
      }
    } catch (err) {
      console.warn('[workspace] Gateway list fallback failed:', (err as Error).message);
      // Return all as non-existent
      for (const [key, filename] of Object.entries(FILE_MAP)) {
        files.push({ key, filename, exists: false });
      }
    }
  }

  return c.json({ ok: true, files, ...(isRemote ? { remoteWorkspace: true } : {}) });
});

export default app;
