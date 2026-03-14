import type { Session } from '@/types';
import { getSessionKey } from '@/types';
import { getSessionType, isTopLevelAgentSessionKey, resolveParentSessionKey } from './sessionKeys';

export interface TreeNode {
  session: Session;
  key: string;
  parentId: string | null;
  depth: number;
  children: TreeNode[];
  isExpanded: boolean;
}

export { getSessionType } from './sessionKeys';

/**
 * Build a hierarchical tree from a flat list of sessions.
 *
 * Dual strategy:
 * 1. If sessions have `parentId` (gateway v2026.2.9+), use that.
 * 2. Fallback: parse session key structure to infer parent-child relationships.
 *
 * Returns an array of root-level TreeNodes (usually just one).
 */
export function buildSessionTree(sessions: Session[]): TreeNode[] {
  if (sessions.length === 0) return [];

  // Build a map of key → session for quick lookup
  const keyMap = new Map<string, Session>();
  for (const s of sessions) {
    keyMap.set(getSessionKey(s), s);
  }
  const knownKeys = new Set(keyMap.keys());

  // Determine parent for each session
  const parentMap = new Map<string, string | null>();
  for (const s of sessions) {
    const sk = getSessionKey(s);
    parentMap.set(sk, resolveParentSessionKey(s, knownKeys));
  }

  // Group children by parent key
  const childrenOf = new Map<string | null, Session[]>();
  for (const s of sessions) {
    const sk = getSessionKey(s);
    const pid = parentMap.get(sk) ?? null;
    const list = childrenOf.get(pid);
    if (list) {
      list.push(s);
    } else {
      childrenOf.set(pid, [s]);
    }
  }

  // Recursive builder
  function buildNodes(parentKey: string | null, depth: number): TreeNode[] {
    const children = childrenOf.get(parentKey);
    if (!children) return [];

    // Sort: subagents first, then crons, then alphabetically
    const typeOrder = { main: 0, subagent: 1, cron: 2, 'cron-run': 3 };
    const sorted = [...children].sort((a, b) => {
      const keyA = getSessionKey(a);
      const keyB = getSessionKey(b);

      if (parentKey === null) {
        if (keyA === 'agent:main:main') return -1;
        if (keyB === 'agent:main:main') return 1;
      }

      const ta = typeOrder[getSessionType(getSessionKey(a))] ?? 9;
      const tb = typeOrder[getSessionType(getSessionKey(b))] ?? 9;
      if (ta !== tb) return ta - tb;

      if (parentKey === null && isTopLevelAgentSessionKey(keyA) && isTopLevelAgentSessionKey(keyB)) {
        const displayA = (a.displayName || a.label || keyA).toLowerCase();
        const displayB = (b.displayName || b.label || keyB).toLowerCase();
        return displayA.localeCompare(displayB);
      }

      // Within cron-runs, sort by most recent first
      if (ta === 3) {
        const timeA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
        const timeB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
        return timeB - timeA;
      }
      const la = (a.displayName || a.label || keyA).toLowerCase();
      const lb = (b.displayName || b.label || keyB).toLowerCase();
      return la.localeCompare(lb);
    });

    return sorted.map((s) => {
      const sk = getSessionKey(s);
      return {
        session: s,
        key: sk,
        parentId: parentKey,
        depth,
        children: buildNodes(sk, depth + 1),
        isExpanded: true,
      };
    });
  }

  return buildNodes(null, 0);
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
