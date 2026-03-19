import { getWorkspaceStorageKey } from './workspaceScope';

function getDraftStorageKey(kind: string, agentId: string): string {
  return getWorkspaceStorageKey(`draft:${kind}`, agentId);
}

export function encodeDraftPart(value: string): string {
  return encodeURIComponent(value);
}

export function readPersistedDraft<T>(kind: string, agentId: string): T | null {
  try {
    const raw = localStorage.getItem(getDraftStorageKey(kind, agentId));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writePersistedDraft(kind: string, agentId: string, value: unknown): void {
  try {
    localStorage.setItem(getDraftStorageKey(kind, agentId), JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export function clearPersistedDraft(kind: string, agentId: string): void {
  try {
    localStorage.removeItem(getDraftStorageKey(kind, agentId));
  } catch {
    // ignore storage errors
  }
}
