/**
 * Gateway API Routes
 *
 * GET  /api/gateway/models       — Returns the gateway's model catalog (models.list RPC), with the
 *                                  active OpenClaw config as fallback for older/unreachable gateways.
 * GET  /api/gateway/session-info — Returns the current session's runtime info (model, thinking level).
 * POST /api/gateway/session-patch — Change model/effort for a session via HTTP (reliable fallback).
 * POST /api/gateway/restart      — Restart the OpenClaw gateway service via `openclaw gateway restart`.
 *
 * Response (models):       { models: Array<{ id: string; label: string; provider: string; alias?: string; configured: boolean; role: string;
 *                                             available?: boolean; tags?: string[];
 *                                             thinkingLevels?: Array<{ id: string; label?: string }>; thinkingDefault?: string }>,
 *                            error: string | null, source: 'gateway' | 'config' }
 * Response (session-info): { model?: string; thinking?: string }
 * Response (session-patch): { ok: boolean; model?: string; thinking?: string; error?: string }
 * Response (restart):      { ok: boolean; output: string }
 */

import { Hono } from 'hono';
import JSON5 from 'json5';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { invokeGatewayTool } from '../lib/gateway-client.js';
import { gatewayRpcCall } from '../lib/gateway-rpc.js';
import { rateLimitGeneral, rateLimitRestart } from '../middleware/rate-limit.js';
import { resolveOpenclawBin } from '../lib/openclaw-bin.js';
import { config } from '../lib/config.js';

const app = new Hono();

const GATEWAY_TIMEOUT_MS = 8_000;
export const MODEL_LIST_TIMEOUT_MS = 15_000;
const SESSIONS_ACTIVE_MINUTES = 24 * 60;
const SESSIONS_LIMIT = 200;

export interface GatewayModelInfo {
  id: string;
  label: string;
  provider: string;
  alias?: string;
  configured: boolean;
  role: 'primary' | 'fallback' | 'allowed';
  /** Whether the gateway currently considers the model usable (omitted when unknown). */
  available?: boolean;
  /** Gateway catalog tags such as `default` or `configured`. */
  tags?: string[];
  /** Thinking levels this specific model supports, as reported by `models.list`. */
  thinkingLevels?: { id: string; label?: string }[];
  /** The level an unset thinking level resolves to for this model. */
  thinkingDefault?: string;
}

interface GatewaySessionSummary {
  sessionKey?: string;
  key?: string;
  model?: string;
  thinking?: string;
  thinkingLevel?: string;
}

// ─── Model catalog via active OpenClaw config ──────────────────────────────────

const openclawBin = resolveOpenclawBin();

/** Directory containing the node binary — needed in PATH for `#!/usr/bin/env node` shims. */
const nodeBinDir = process.execPath.replace(/\/node$/, '');

const CONFIG_READ_ERROR = 'Could not read OpenClaw config.';
const NO_CONFIGURED_MODELS_ERROR = 'No models configured in OpenClaw config.';

interface OpenClawModelConfigEntry {
  alias?: string;
}

interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      models?: Record<string, OpenClawModelConfigEntry | undefined>;
    };
  };
}

/**
 * Infer the HOME directory for openclaw execution.
 * When server runs as root but openclaw is installed under a user account
 * (e.g., /home/username/.nvm/...), we need to use that user's HOME so openclaw
 * can find its config at ~/.openclaw/openclaw.json.
 *
 * Extracts home from paths like:
 *   /home/username/.nvm/... → /home/username
 *   /Users/username/.nvm/... → /Users/username
 *
 * Falls back to process.env.HOME if extraction fails.
 */
function inferOpenclawHome(): string {
  const match = openclawBin.match(/^(\/home\/[^/]+|\/Users\/[^/]+)/);
  if (match) return match[1];

  return process.env.HOME || homedir();
}

const openclawHome = inferOpenclawHome();

function resolveOpenClawConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH?.trim() || path.join(openclawHome, '.openclaw', 'openclaw.json');
}

function normalizeAlias(entry: OpenClawModelConfigEntry | undefined): string | undefined {
  const alias = entry?.alias;
  return typeof alias === 'string' && alias.trim() ? alias.trim() : undefined;
}

function buildGatewayModelInfo(
  id: string,
  role: GatewayModelInfo['role'],
  entry: OpenClawModelConfigEntry | undefined,
): GatewayModelInfo {
  const alias = normalizeAlias(entry);
  const [provider, ...rest] = id.split('/');

  return {
    id,
    label: alias || rest.join('/') || id,
    provider: provider || 'unknown',
    ...(alias ? { alias } : {}),
    configured: true,
    role,
  };
}

function readConfiguredModels(configData: OpenClawConfig): GatewayModelInfo[] {
  const defaults = configData.agents?.defaults;
  const modelDefaults = defaults?.model;
  const allowlist = defaults?.models || {};
  const seen = new Set<string>();
  const models: GatewayModelInfo[] = [];

  const addModel = (value: unknown, role: GatewayModelInfo['role']) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const id = value.trim();
    if (seen.has(id)) return;
    seen.add(id);
    models.push(buildGatewayModelInfo(id, role, allowlist[id]));
  };

  addModel(modelDefaults?.primary, 'primary');

  for (const fallback of modelDefaults?.fallbacks || []) {
    addModel(fallback, 'fallback');
  }

  const remainingAllowlistEntries = Object.keys(allowlist)
    .filter((id) => !seen.has(id))
    .sort((a, b) => a.localeCompare(b));

  for (const id of remainingAllowlistEntries) {
    addModel(id, 'allowed');
  }

  return models;
}

// ─── Model catalog via the gateway `models.list` RPC ──────────────────────────

/** A row from the gateway's `models.list` response; fields are validated defensively. */
interface GatewayModelsListRow {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  alias?: unknown;
  available?: unknown;
  tags?: unknown;
  thinkingLevels?: unknown;
  thinkingDefault?: unknown;
}

interface ModelConfigHints {
  primary: string | null;
  fallbacks: string[];
  aliases: Map<string, string>;
  allowlisted: Set<string>;
}

const THINKING_LEVEL_ID = /^[a-z][a-z0-9_-]*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strip auth-profile suffixes (`model@provider:profile`) and surrounding whitespace. */
function normalizeModelRef(value: string): string {
  return value.trim().split('@')[0]?.trim() || '';
}

function bareModelId(ref: string): string {
  const idx = ref.indexOf('/');
  return idx >= 0 ? ref.slice(idx + 1) : ref;
}

/**
 * Resolve a catalog id to a single config ref when only one config ref has that bare model id.
 * Provider catalogs commonly reuse ids (`gpt-6-luna` on both `openai` and `opencode-go`), so a
 * bare-id match is only safe when it is unambiguous.
 */
function uniqueBareMatch(catalogId: string, refs: Iterable<string>): string | undefined {
  const bare = bareModelId(catalogId);
  const matches = new Set<string>();
  for (const ref of refs) {
    if (bareModelId(ref) === bare) matches.add(ref);
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

function allConfigRefs(hints: ModelConfigHints): string[] {
  return [
    ...(hints.primary ? [hints.primary] : []),
    ...hints.fallbacks,
    ...hints.allowlisted,
  ];
}

/**
 * Config is only an enrichment source for the RPC catalog (aliases + roles). A missing or
 * unreadable config must not hide models the gateway reports.
 */
async function readConfigHints(): Promise<ModelConfigHints> {
  const hints: ModelConfigHints = {
    primary: null,
    fallbacks: [],
    aliases: new Map(),
    allowlisted: new Set(),
  };

  try {
    const raw = await readFile(resolveOpenClawConfigPath(), 'utf8');
    const configData = JSON5.parse(raw) as OpenClawConfig;
    const defaults = configData.agents?.defaults;
    const primary = defaults?.model?.primary;
    if (typeof primary === 'string' && normalizeModelRef(primary)) {
      hints.primary = normalizeModelRef(primary);
    }
    for (const fallback of defaults?.model?.fallbacks || []) {
      if (typeof fallback === 'string' && normalizeModelRef(fallback)) {
        hints.fallbacks.push(normalizeModelRef(fallback));
      }
    }
    for (const [id, entry] of Object.entries(defaults?.models || {})) {
      const ref = normalizeModelRef(id);
      if (!ref) continue;
      hints.allowlisted.add(ref);
      const alias = normalizeAlias(entry);
      if (alias) hints.aliases.set(ref, alias);
    }
  } catch {
    // Config is optional when the gateway answers models.list.
  }

  return hints;
}

function resolveCatalogRole(catalogId: string, hints: ModelConfigHints): GatewayModelInfo['role'] {
  if (hints.primary === catalogId) return 'primary';
  if (hints.fallbacks.includes(catalogId)) return 'fallback';

  const ref = uniqueBareMatch(catalogId, allConfigRefs(hints));
  if (!ref) return 'allowed';
  if (hints.primary === ref) return 'primary';
  if (hints.fallbacks.includes(ref)) return 'fallback';
  return 'allowed';
}

function findConfigAlias(catalogId: string, hints: ModelConfigHints): string | undefined {
  const exact = hints.aliases.get(catalogId);
  if (exact) return exact;

  // Ambiguity is judged against every configured ref, not just the aliased ones: a provider twin
  // without an alias must not inherit its sibling's alias.
  const ref = uniqueBareMatch(catalogId, allConfigRefs(hints));
  return ref ? hints.aliases.get(ref) : undefined;
}

function configKnowsModel(catalogId: string, hints: ModelConfigHints): boolean {
  if (hints.allowlisted.has(catalogId)) return true;
  const ref = uniqueBareMatch(catalogId, hints.allowlisted);
  return ref !== undefined;
}

/** Canonicalise a gateway thinking-level list, dropping malformed placeholder entries. */
function normalizeCatalogThinkingLevels(raw: unknown): { id: string; label?: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const levels: { id: string; label?: string }[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    let id: string | undefined;
    let label: string | undefined;
    if (typeof entry === 'string') {
      id = entry.trim();
    } else if (isRecord(entry) && typeof entry.id === 'string') {
      id = entry.id.trim();
      if (typeof entry.label === 'string' && entry.label.trim()) label = entry.label.trim();
    }
    if (!id || !THINKING_LEVEL_ID.test(id)) continue;
    const normalized = id.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    levels.push(label ? { id: normalized, label } : { id: normalized });
  }

  return levels.length > 0 ? levels : undefined;
}

/**
 * `models.list` rows carry the bare model id plus its provider (`gpt-6-luna` + `openai`),
 * while session APIs address models as `provider/model`. Normalise to the latter.
 */
function qualifyCatalogModel(provider: string, rawId: string): { id: string; provider: string; bareId: string } {
  const trimmedProvider = provider.trim();
  if (!trimmedProvider) {
    const [head, ...rest] = rawId.split('/');
    return rest.length > 0
      ? { id: rawId, provider: head, bareId: rest.join('/') }
      : { id: rawId, provider: 'unknown', bareId: rawId };
  }
  if (rawId.startsWith(`${trimmedProvider}/`)) {
    return { id: rawId, provider: trimmedProvider, bareId: rawId.slice(trimmedProvider.length + 1) };
  }
  return { id: `${trimmedProvider}/${rawId}`, provider: trimmedProvider, bareId: rawId };
}

function buildCatalogFromModelsList(rows: unknown[], hints: ModelConfigHints): GatewayModelInfo[] {
  const models: GatewayModelInfo[] = [];
  const seen = new Set<string>();

  for (const rawRow of rows) {
    if (!isRecord(rawRow)) continue;
    const row = rawRow as GatewayModelsListRow;
    // Unavailable rows are not selectable; skip them unless the gateway omits the flag.
    if (row.available === false) continue;

    const rawId = typeof row.id === 'string' ? row.id.trim() : '';
    if (!rawId) continue;

    const provider = typeof row.provider === 'string' ? row.provider : '';
    const { id, provider: resolvedProvider, bareId } = qualifyCatalogModel(provider, rawId);
    if (seen.has(id)) continue;
    seen.add(id);

    const tags = Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : [];
    const role = resolveCatalogRole(id, hints);
    const alias = findConfigAlias(id, hints)
      || (typeof row.alias === 'string' && row.alias.trim() ? row.alias.trim() : undefined);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : undefined;
    const thinkingLevels = normalizeCatalogThinkingLevels(row.thinkingLevels);
    const thinkingDefault = typeof row.thinkingDefault === 'string' && row.thinkingDefault.trim()
      ? row.thinkingDefault.trim().toLowerCase()
      : undefined;
    const configured = tags.includes('configured') || role !== 'allowed' || configKnowsModel(id, hints);

    models.push({
      id,
      label: alias || name || bareId,
      provider: resolvedProvider,
      ...(alias ? { alias } : {}),
      configured,
      role,
      ...(typeof row.available === 'boolean' ? { available: row.available } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(thinkingLevels ? { thinkingLevels } : {}),
      ...(thinkingDefault ? { thinkingDefault } : {}),
    });
  }

  return models;
}

/**
 * Read the live catalog from the gateway's `models.list` RPC.
 * Returns null when the gateway is unreachable or predates the method, so callers can
 * fall back to the config reader.
 */
async function getGatewayModelCatalog(): Promise<GatewayModelInfo[] | null> {
  let payload: unknown;
  try {
    payload = await gatewayRpcCall('models.list', {}, MODEL_LIST_TIMEOUT_MS);
  } catch (err) {
    console.warn('[gateway/models] models.list unavailable, falling back to config:', (err as Error).message);
    return null;
  }

  const rows = isRecord(payload) && Array.isArray(payload.models) ? payload.models : null;
  if (!rows || rows.length === 0) return null;

  const models = buildCatalogFromModelsList(rows, await readConfigHints());
  return models.length > 0 ? models : null;
}

async function getModelCatalog(): Promise<{ models: GatewayModelInfo[]; error: string | null }> {
  const configPath = resolveOpenClawConfigPath();

  try {
    const raw = await readFile(configPath, 'utf8');
    const configData = JSON5.parse(raw) as OpenClawConfig;
    const models = readConfiguredModels(configData);

    if (models.length === 0) {
      return { models: [], error: NO_CONFIGURED_MODELS_ERROR };
    }

    return { models, error: null };
  } catch (err) {
    console.warn('[gateway/models] failed to read configured models from config:', configPath, (err as Error).message);
    return { models: [], error: CONFIG_READ_ERROR };
  }
}

app.get('/api/gateway/models', rateLimitGeneral, async (c) => {
  // Prefer the live gateway catalog: it covers every model enabled on the gateway, not just the
  // ones named in agents.defaults.model / the allowlist, and carries per-model thinking levels.
  const catalog = await getGatewayModelCatalog();
  if (catalog) {
    return c.json({ models: catalog, error: null, source: 'gateway' });
  }

  const { models, error } = await getModelCatalog();
  return c.json({ models, error, source: 'config' });
});

/**
 * Extract the current session's thinking/effort level from gateway status.
 * Looks in common locations: agent.thinking, config.thinking, top-level thinking,
 * and falls back to parsing the runtime string (e.g. "thinking=medium").
 */
function extractThinking(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  // Direct fields
  const candidates = [
    p.thinking,
    (p.agent as Record<string, unknown> | undefined)?.thinking,
    (p.config as Record<string, unknown> | undefined)?.thinking,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().toLowerCase();
  }

  // Parse from runtime string (e.g. "thinking=medium")
  const runtime = p.runtime || (p.agent as Record<string, unknown> | undefined)?.runtime;
  if (typeof runtime === 'string') {
    const match = runtime.match(/thinking=(\w+)/);
    if (match) return match[1].toLowerCase();
  }

  return null;
}

/**
 * Extract the current session's model from gateway status.
 */
function extractSessionModel(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const candidates = [
    p.model,
    p.defaultModel,
    (p.agent as Record<string, unknown> | undefined)?.model,
    (p.config as Record<string, unknown> | undefined)?.model,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }

  // Parse from runtime string (e.g. "model=anthropic/claude-opus-4-6")
  const runtime = p.runtime || (p.agent as Record<string, unknown> | undefined)?.runtime;
  if (typeof runtime === 'string') {
    const match = runtime.match(/model=(\S+)/);
    if (match) return match[1];
  }

  return null;
}

function getGatewaySessionKey(session: GatewaySessionSummary): string {
  return session.sessionKey || session.key || '';
}

function isTopLevelAgentSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:main$/.test(sessionKey);
}

function pickPreferredSessionKey(sessions: GatewaySessionSummary[]): string {
  const explicitMain = sessions.find((session) => getGatewaySessionKey(session) === 'agent:main:main');
  if (explicitMain) return 'agent:main:main';

  const firstRoot = sessions.find((session) => isTopLevelAgentSessionKey(getGatewaySessionKey(session)));
  if (firstRoot) return getGatewaySessionKey(firstRoot);

  return getGatewaySessionKey(sessions[0] || {});
}

app.get('/api/gateway/session-info', rateLimitGeneral, async (c) => {
  const requestedSessionKey = c.req.query('sessionKey')?.trim() || '';
  const info: { model?: string; thinking?: string } = {};

  // Primary: fetch per-session data from sessions.list (source of truth for per-session state)
  try {
    const result = await invokeGatewayTool(
      'sessions_list',
      { activeMinutes: SESSIONS_ACTIVE_MINUTES, limit: SESSIONS_LIMIT },
      GATEWAY_TIMEOUT_MS,
    ) as Record<string, unknown>;

    // sessions_list output shape may vary depending on gateway version:
    // - { sessions: [...] }
    // - { details: { sessions: [...] }, ... }
    const r = result as unknown as { sessions?: unknown; details?: { sessions?: unknown } };
    const sessions = (Array.isArray(r.sessions)
      ? r.sessions
      : Array.isArray(r.details?.sessions)
        ? r.details?.sessions
        : []) as GatewaySessionSummary[];
    const sessionKey = requestedSessionKey || pickPreferredSessionKey(sessions);
    const session = sessions.find(s => (s.sessionKey || s.key) === sessionKey);
    if (session) {
      if (session.model) info.model = session.model;
      const thinking = session.thinking || session.thinkingLevel;
      if (thinking) info.thinking = thinking.toLowerCase();
    }
    if (info.model || info.thinking) return c.json(info);
  } catch (err) {
    console.warn(`[gateway/session-info] sessions_list failed:`, (err as Error).message);
  }

  // Fallback: try global status tools (less accurate — returns global defaults, not per-session)
  const toolsToTry = ['session_status'];
  for (const tool of toolsToTry) {
    try {
      const result = await invokeGatewayTool(tool, {}, GATEWAY_TIMEOUT_MS);
      const thinking = extractThinking(result);
      const model = extractSessionModel(result);
      if (thinking && !info.thinking) info.thinking = thinking;
      if (model && !info.model) info.model = model;
      if (info.thinking && info.model) return c.json(info);
    } catch (err) {
      console.warn(`[gateway/session-info] ${tool} failed:`, (err as Error).message);
    }
  }

  return c.json(info);
});

// ─── Session patch via HTTP (reliable fallback for WS RPC) ─────────────────────

const sessionPatchSchema = z.object({
  sessionKey: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  thinkingLevel: z.string().max(50).nullable().optional(),
});

type SessionPatchBody = z.infer<typeof sessionPatchSchema>;

/**
 * POST /api/gateway/session-patch
 *
 * Changes model and/or thinking level for a session.  Uses the `session_status`
 * tool for model changes (proven reliable) and `sessions_list` + gateway WS RPC
 * fallback for thinking level.
 *
 * This exists as a reliable HTTP fallback when the frontend's direct WS RPC
 * (`sessions.patch`) fails due to proxy issues, reconnection races, etc.
 */
app.post('/api/gateway/session-patch', rateLimitGeneral, async (c) => {
  let body: SessionPatchBody;
  try {
    const raw = await c.req.json();
    const parsed = sessionPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid body' }, 400);
    }
    body = parsed.data;
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  let sessionKey = body.sessionKey?.trim() || '';
  const result: { ok: boolean; model?: string; thinking?: string; error?: string } = { ok: true };

  if (!sessionKey) {
    try {
      const listResult = await invokeGatewayTool(
        'sessions_list',
        { activeMinutes: SESSIONS_ACTIVE_MINUTES, limit: SESSIONS_LIMIT },
        GATEWAY_TIMEOUT_MS,
      ) as Record<string, unknown>;
      const r = listResult as { sessions?: unknown; details?: { sessions?: unknown } };
      const sessions = (Array.isArray(r.sessions)
        ? r.sessions
        : Array.isArray(r.details?.sessions)
          ? r.details?.sessions
          : []) as GatewaySessionSummary[];
      sessionKey = pickPreferredSessionKey(sessions);
    } catch (err) {
      console.warn('[gateway/session-patch] sessions_list fallback failed:', (err as Error).message);
    }
  }

  if (!sessionKey) {
    return c.json(
      { ok: false, error: 'No active root session available. Provide sessionKey explicitly.' },
      409,
    );
  }

  // Change model via session_status tool (reliable — uses HTTP tools/invoke)
  if (body.model) {
    try {
      const statusResult = await invokeGatewayTool(
        'session_status',
        { model: body.model, sessionKey },
        GATEWAY_TIMEOUT_MS,
      ) as Record<string, unknown>;

      // Extract confirmed model from response
      const details = statusResult?.details as Record<string, unknown> | undefined;
      if (details?.changedModel === false && details?.statusText) {
        // session_status returns changedModel:false when model is already set or change failed
        // Parse the model from status text as confirmation
        const statusText = details.statusText as string;
        const modelMatch = statusText.match(/Model:\s*(\S+)/);
        result.model = modelMatch?.[1] || body.model;
      } else {
        result.model = body.model;
      }
    } catch (err) {
      console.warn('[gateway/session-patch] session_status model change failed:', (err as Error).message);
      result.ok = false;
      result.error = `Model change failed: ${(err as Error).message}`;
      return c.json(result, 502);
    }
  }

  // Thinking level changes are NOT supported via this HTTP endpoint.
  // The gateway's session_status tool doesn't accept thinkingLevel.
  // The frontend should use the WS RPC (sessions.patch) for thinking changes.
  if (body.thinkingLevel !== undefined && !body.model) {
    return c.json({ ok: false, error: 'Thinking level changes are only supported via WebSocket RPC' }, 501);
  } else if (body.thinkingLevel !== undefined) {
    // Model change succeeded above, but note thinking was not applied
    result.thinking = undefined;
  }

  return c.json(result);
});

// ── POST /api/gateway/restart ───────────────────────────────────────

const GATEWAY_RESTART_TIMEOUT_MS = 15_000;

app.post('/api/gateway/restart', rateLimitRestart, async (c) => {
  // DBus session vars are required for `systemctl --user` commands.
  // When Nerve runs as a system service these may be absent; provide fallbacks.
  const uid = process.getuid?.() ?? 1000;
  const xdgRuntime = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;

  const execEnv = {
    ...process.env,
    HOME: openclawHome,
    PATH: `${nodeBinDir}:${process.env.PATH || '/usr/bin:/bin'}`,
    XDG_RUNTIME_DIR: xdgRuntime,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${xdgRuntime}/bus`,
  };

  // Step 1: restart the gateway
  const restartResult = await new Promise<{ ok: boolean; output: string }>((resolve) => {
    execFile(openclawBin, ['gateway', 'restart'], {
      timeout: GATEWAY_RESTART_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
      env: execEnv,
    }, (err, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      if (err) {
        resolve({ ok: false, output: output || err.message });
      } else {
        // Treat zero exit code as success; actual health is verified in step 2.
        resolve({ ok: true, output });
      }
    });
  });

  if (!restartResult.ok) {
    return c.json(restartResult, 500);
  }

  // Step 2: verify gateway is actually running AND listening (not just systemd reporting)
  // Wait 2s after restart command, then retry up to 8 times with 1s delay (max ~10s total)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  let statusResult: { ok: boolean; output: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // First check if systemd reports it as running
    statusResult = await new Promise<{ ok: boolean; output: string }>((resolve) => {
      execFile(openclawBin, ['gateway', 'status'], {
        timeout: 5000,
        maxBuffer: 512 * 1024,
        env: execEnv,
      }, (err, stdout, stderr) => {
        const output = (stdout + stderr).trim();
        if (err) {
          resolve({ ok: false, output: output || err.message });
        } else {
          // Check for positive running state AND absence of failure indicators
          const running = output.includes('Runtime: running');
          const activating = output.includes('state activating');
          const failed = output.includes('last exit 1') && !running;
          // activating is a normal transitional state -- keep retrying
          const ok = running && !failed;
          if (activating && !running) { resolve({ ok: false, output }); return; }
          resolve({ ok, output });
        }
      });
    });
    
    if (!statusResult.ok) continue;
    
    // If systemd reports running, verify the port is actually listening
    const portTest = await new Promise<boolean>((resolve) => {
      const socket = new Socket();
      
      const gwUrl = new URL(config.gatewayUrl);
      const gwPort = parseInt(gwUrl.port, 10) || 18789;
      socket.setTimeout(2000);
      socket.connect(gwPort, gwUrl.hostname, () => {
        socket.end();
        resolve(true);
      });
      
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
    
    if (portTest) break;
    
    // Port not ready yet, continue retrying
    statusResult.ok = false;
    statusResult.output += '\nGateway running but port not ready yet';
  }

  if (!statusResult || !statusResult.ok) {
    return c.json({
      ok: false,
      output: `Gateway restarted but not running. Status:\n${statusResult?.output || 'Status check failed'}`,
    }, 500);
  }

  return c.json({ ok: true, output: 'Gateway restarted successfully' });
});

export default app;
