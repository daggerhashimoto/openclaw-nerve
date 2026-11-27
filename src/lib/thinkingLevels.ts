/**
 * Thinking level vocabulary shared by the chat header, spawn dialog, and gateway helpers.
 *
 * OpenClaw's canonical set is defined in `ALL_THINKING_LEVELS`; providers expose a subset per
 * model. The gateway reports that subset on each `sessions.list` row as `thinkingLevels`
 * (`{ id, label }[]`) and `thinkingOptions` (`string[]`), so the UI must not assume the generic
 * five-level ladder. A DeepSeek model on the opencode harness, for example, offers
 * `off | low | high | max | ultra`.
 */

/** Every level OpenClaw accepts in `sessions.patch` / `/think`. */
export const THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'adaptive',
  'max',
  'ultra',
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_LEVEL_SET: ReadonlySet<string> = new Set(THINKING_LEVELS);

/** Canonicalise a gateway-reported level; unknown placeholders such as `--` become null. */
export function normalizeThinkingLevel(raw: string | null | undefined): ThinkingLevel | null {
  const normalized = raw?.trim().toLowerCase();
  return normalized && THINKING_LEVEL_SET.has(normalized) ? (normalized as ThinkingLevel) : null;
}

export interface GatewayThinkingLevel {
  id: string;
  label?: string;
}

export interface ThinkingLevelOption {
  id: string;
  label: string;
}

function isLevelId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[a-z][a-z0-9_-]*$/i.test(raw.trim());
}

/**
 * Levels a session's current model supports, in the gateway's own order.
 *
 * Falls back to `thinkingOptions`, then to the canonical vocabulary when an older gateway does
 * not project per-session levels.
 */
export function thinkingLevelsForSession(
  session?: { thinkingLevels?: GatewayThinkingLevel[] | null; thinkingOptions?: string[] | null } | null,
): ThinkingLevelOption[] {
  const reported = (session?.thinkingLevels ?? [])
    .filter((level): level is GatewayThinkingLevel => isLevelId(level?.id))
    .map((level) => ({ id: level.id.trim().toLowerCase(), label: level.label?.trim() || level.id.trim().toLowerCase() }));

  if (reported.length > 0) return reported;

  const options = (session?.thinkingOptions ?? [])
    .filter(isLevelId)
    .map((id) => id.trim().toLowerCase());

  if (options.length > 0) return options.map((id) => ({ id, label: id }));

  return THINKING_LEVELS.map((id) => ({ id, label: id }));
}
