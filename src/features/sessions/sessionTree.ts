import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import { getExplicitParentCandidates, getRootAgentSessionKey, getSessionType, isTopLevelAgentSessionKey, resolveParentSessionKey } from './sessionKeys';

export interface TreeNode {
  session: Session;
  key: string;
  parentId: string | null;
  depth: number;
  children: TreeNode[];
  isExpanded: boolean;
}

export { getSessionType } from './sessionKeys';

/** True only for real top-level agent roots that belong in the AGENTS sidebar. */
export function isAgentSidebarRootSessionKey(sessionKey: string): boolean {
  return isTopLevelAgentSessionKey(sessionKey);
}

function buildParentMap(sessions: Session[]): Map<string, string | null> {
  const keyMap = new Map<string, Session>();
  for (const session of sessions) {
    keyMap.set(getSessionKey(session), session);
  }

  const knownKeys = new Set(keyMap.keys());
  const parentMap = new Map<string, string | null>();
  for (const session of sessions) {
    const sessionKey = getSessionKey(session);
    parentMap.set(sessionKey, resolveParentSessionKey(session, knownKeys));
  }

  return parentMap;
}

function hasAgentSidebarEligibleLineage(
  sessionKey: string,
  parentMap: Map<string, string | null>,
  sessionMap: Map<string, Session>,
  memo: Map<string, boolean>,
  visiting = new Set<string>(),
): boolean {
  if (memo.has(sessionKey)) return memo.get(sessionKey) ?? false;
  if (visiting.has(sessionKey)) return false;

  visiting.add(sessionKey);

  const parentKey = parentMap.get(sessionKey) ?? null;
  const session = sessionMap.get(sessionKey);
  const result = parentKey === null
    ? isAgentSidebarRootSessionKey(sessionKey)
      || getExplicitParentCandidates(session).some((explicitParent) => getRootAgentSessionKey(explicitParent) !== null)
      || getRootAgentSessionKey(sessionKey) !== null
    : parentMap.has(parentKey) && hasAgentSidebarEligibleLineage(parentKey, parentMap, sessionMap, memo, visiting);

  visiting.delete(sessionKey);
  memo.set(sessionKey, result);
  return result;
}

function filterAgentSidebarSessions(
  sessions: Session[],
  parentMap: Map<string, string | null>,
): Session[] {
  const sessionMap = new Map(sessions.map((session) => [getSessionKey(session), session]));
  const memo = new Map<string, boolean>();
  return sessions.filter((session) => hasAgentSidebarEligibleLineage(getSessionKey(session), parentMap, sessionMap, memo));
}

function buildTreeNodes(
  renderSessions: Session[],
  parentMap: Map<string, string | null>,
): TreeNode[] {
  if (renderSessions.length === 0) return [];

  const childrenOf = new Map<string | null, Session[]>();
  for (const session of renderSessions) {
    const sessionKey = getSessionKey(session);
    const parentKey = parentMap.get(sessionKey) ?? null;
    const list = childrenOf.get(parentKey);
    if (list) {
      list.push(session);
    } else {
      childrenOf.set(parentKey, [session]);
    }
  }

  const typeOrder = { main: 0, subagent: 1, cron: 2, 'cron-run': 3 };

  function buildNodes(parentKey: string | null, depth: number): TreeNode[] {
    const children = childrenOf.get(parentKey);
    if (!children) return [];

    const sorted = [...children].sort((a, b) => {
      const keyA = getSessionKey(a);
      const keyB = getSessionKey(b);

      if (parentKey === null) {
        if (keyA === 'agent:main:main') return -1;
        if (keyB === 'agent:main:main') return 1;
      }

      const ta = typeOrder[getSessionType(keyA)] ?? 9;
      const tb = typeOrder[getSessionType(keyB)] ?? 9;
      if (ta !== tb) return ta - tb;

      if (parentKey === null && isTopLevelAgentSessionKey(keyA) && isTopLevelAgentSessionKey(keyB)) {
        const displayA = (a.displayName || a.label || keyA).toLowerCase();
        const displayB = (b.displayName || b.label || keyB).toLowerCase();
        return displayA.localeCompare(displayB);
      }

      if (ta === 3) {
        const timeA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const timeB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return timeB - timeA;
      }

      const labelA = (a.displayName || a.label || keyA).toLowerCase();
      const labelB = (b.displayName || b.label || keyB).toLowerCase();
      return labelA.localeCompare(labelB);
    });

    return sorted.map((session) => {
      const sessionKey = getSessionKey(session);
      return {
        session,
        key: sessionKey,
        parentId: parentKey,
        depth,
        children: buildNodes(sessionKey, depth + 1),
        isExpanded: true,
      };
    });
  }

  return buildNodes(null, 0);
}

/**
 * Build a hierarchical tree from a flat list of sessions.
 *
 * Dual strategy:
 * 1. If sessions have `parentSessionKey`/`parentId`, use that.
 * 2. Fallback: parse session key structure to infer parent-child relationships.
 *
 * Returns an array of root-level TreeNodes (usually just one).
 */
export function buildSessionTree(sessions: Session[]): TreeNode[] {
  const parentMap = buildParentMap(sessions);
  return buildTreeNodes(sessions, parentMap);
}

/** Build the AGENTS sidebar tree, limited to real agent roots and their descendants. */
export function buildAgentSidebarTree(sessions: Session[]): TreeNode[] {
  const parentMap = buildParentMap(sessions);
  const eligibleSessions = filterAgentSidebarSessions(sessions, parentMap);
  return buildTreeNodes(eligibleSessions, parentMap);
}

/** Flatten a tree into an ordered list, respecting collapsed state. */
export function flattenTree(
  roots: TreeNode[],
  expandedState: Record<string, boolean>,
): TreeNode[] {
  const result: TreeNode[] = [];

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      result.push(node);
      const isExpanded = expandedState[node.key] ?? node.isExpanded;
      if (isExpanded && node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(roots);
  return result;
}
