import { isTopLevelAgentSessionKey } from './sessionKeys';

/**
 * True for sessions the OpenClaw gateway refuses to delete with sessions.delete.
 *
 * OpenClaw 2026.9 refuses every agent's main session (agent:<id>:main) and the shared
 * "global" session ("Cannot delete the main session"). Older gateways such as 2026.5
 * refuse only the default agent's main session, so on those this is stricter than needed,
 * which is the safe direction: it never lets a refused delete start.
 */
export function isUndeletableSessionKey(sessionKey: string): boolean {
  return sessionKey === 'global' || isTopLevelAgentSessionKey(sessionKey);
}

/** Why a delete over these keys would be refused, or null when the gateway accepts every key. */
export function getSessionDeleteRefusal(sessionKeys: readonly string[]): string | null {
  const blocked = sessionKeys.find(isUndeletableSessionKey);
  if (!blocked) return null;
  return `Nothing was deleted: ${blocked} is an agent main session, and the gateway does not allow deleting it.`;
}
