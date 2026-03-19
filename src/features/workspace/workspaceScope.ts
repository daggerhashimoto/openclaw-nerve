import { getRootAgentId, getRootAgentSessionKey } from '@/features/sessions/sessionKeys';

const DEFAULT_WORKSPACE_AGENT_ID = 'main';
const DEFAULT_WORKSPACE_ROOT_SESSION_KEY = 'agent:main:main';

export function getWorkspaceAgentId(sessionKey: string): string {
  return getRootAgentId(sessionKey) ?? DEFAULT_WORKSPACE_AGENT_ID;
}

export function getWorkspaceRootSessionKey(sessionKey: string): string {
  return getRootAgentSessionKey(sessionKey) ?? DEFAULT_WORKSPACE_ROOT_SESSION_KEY;
}

export function getWorkspaceStorageKey(kind: string, agentId: string): string {
  const scopedAgentId = agentId.trim() || DEFAULT_WORKSPACE_AGENT_ID;
  return `nerve:workspace:${scopedAgentId}:${kind}`;
}
