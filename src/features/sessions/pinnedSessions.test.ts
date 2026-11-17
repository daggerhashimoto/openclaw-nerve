/** Tests for the pinned-session helpers and the order they give the session tree. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/types';
import {
  PINNED_SESSIONS_STORAGE_KEY,
  loadPinnedSessions,
  parsePinnedSessions,
  pinnedFirst,
  removePinnedSessions,
  resetPinnedSessionsCache,
  savePinnedSessions,
  togglePinnedSession,
  togglePinnedSessionKey,
  unpinSessions,
  usePinnedSessions,
} from './pinnedSessions';
import { buildAgentSidebarTree, buildSessionTree, flattenTree, type TreeNode } from './sessionTree';

function session(key: string, extra: Partial<Session> = {}): Session {
  return { sessionKey: key, ...extra };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('SecurityError: storage is disabled');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

/** Each node as key, parent and depth, in row order with every branch open. */
function shape(roots: TreeNode[]) {
  return flattenTree(roots, {}).map((node) => ({ key: node.key, parentId: node.parentId, depth: node.depth }));
}

beforeEach(() => {
  localStorage.clear();
  resetPinnedSessionsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetPinnedSessionsCache();
});

describe('togglePinnedSession', () => {
  it('pins a session that is not pinned and unpins one that is', () => {
    const pinned = togglePinnedSession([], 'agent:ops:main');
    expect(pinned).toEqual(['agent:ops:main']);
    expect(togglePinnedSession(pinned, 'agent:ops:subagent:worker')).toEqual(['agent:ops:main', 'agent:ops:subagent:worker']);
    expect(togglePinnedSession(pinned, 'agent:ops:main')).toEqual([]);
  });

  it('leaves the array it was given untouched', () => {
    const pinned = ['agent:ops:main'];
    togglePinnedSession(pinned, 'agent:ops:main');
    expect(pinned).toEqual(['agent:ops:main']);
  });
});

describe('removePinnedSessions', () => {
  it('drops only the given keys', () => {
    expect(removePinnedSessions(['a', 'b', 'c'], ['a', 'c', 'zzz'])).toEqual(['b']);
  });

  it('returns the same array when none of the keys was pinned', () => {
    const pinned = ['a'];
    expect(removePinnedSessions(pinned, ['b'])).toBe(pinned);
  });
});

describe('pinnedFirst', () => {
  it('moves pinned items to the front and keeps both groups in their incoming order', () => {
    const pinned = new Set(['d', 'b']);
    expect(pinnedFirst(['a', 'b', 'c', 'd', 'e'], (item) => pinned.has(item))).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('keeps the order when nothing or everything is pinned', () => {
    expect(pinnedFirst(['a', 'b', 'c'], () => false)).toEqual(['a', 'b', 'c']);
    expect(pinnedFirst(['a', 'b', 'c'], () => true)).toEqual(['a', 'b', 'c']);
  });
});

describe('parsePinnedSessions and loadPinnedSessions', () => {
  it('reads a stored array of session keys', () => {
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify(['agent:ops:main', 'agent:ops:subagent:worker']));
    expect(loadPinnedSessions()).toEqual(['agent:ops:main', 'agent:ops:subagent:worker']);
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['broken JSON', '["agent:ops:main"'],
    ['an object', '{"agent:ops:main":true}'],
    ['a string', '"agent:ops:main"'],
    ['a number', '42'],
    ['null', 'null'],
  ])('treats %s as no pins', (_label, raw) => {
    expect(parsePinnedSessions(raw)).toEqual([]);
  });

  it('keeps the string keys of a mixed array once each and drops the rest', () => {
    expect(parsePinnedSessions(JSON.stringify(['a', 7, null, '', 'b', 'a', { key: 'c' }]))).toEqual(['a', 'b']);
  });

  it('reads no pins when the storage throws', () => {
    expect(loadPinnedSessions(throwingStorage())).toEqual([]);
  });

  it('reads no pins when the browser has no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadPinnedSessions()).toEqual([]);
  });
});

describe('savePinnedSessions', () => {
  it('writes the keys as a JSON array', () => {
    savePinnedSessions(['agent:ops:main']);
    expect(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)).toBe('["agent:ops:main"]');
  });

  it('swallows a storage that throws on write', () => {
    expect(() => savePinnedSessions(['agent:ops:main'], throwingStorage())).not.toThrow();
  });
});

describe('pin store', () => {
  it('still pins for this page when localStorage throws on every call', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    resetPinnedSessionsCache();
    const { result } = renderHook(() => usePinnedSessions());
    expect(result.current.pinnedKeys.size).toBe(0);

    act(() => result.current.togglePin('agent:ops:main'));

    expect([...result.current.pinnedKeys]).toEqual(['agent:ops:main']);
  });

  it('takes the pins another tab wrote, so its next toggle keeps them', () => {
    const { result, unmount } = renderHook(() => usePinnedSessions());
    act(() => result.current.togglePin('agent:ops:main'));

    // The other tab pins a second session; this tab hears it through the storage event
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify(['agent:ops:main', 'agent:ops:subagent:other-tab']));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: PINNED_SESSIONS_STORAGE_KEY }));
    });
    expect([...result.current.pinnedKeys]).toEqual(['agent:ops:main', 'agent:ops:subagent:other-tab']);

    // Still followed with no column mounted, as when the compact column is closed
    unmount();
    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify(['agent:ops:subagent:other-tab']));
    window.dispatchEvent(new StorageEvent('storage', { key: PINNED_SESSIONS_STORAGE_KEY }));
    togglePinnedSessionKey('agent:ops:subagent:here');
    expect(loadPinnedSessions()).toEqual(['agent:ops:subagent:other-tab', 'agent:ops:subagent:here']);
  });

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => usePinnedSessions());
    act(() => result.current.togglePin('agent:ops:main'));
    const before = result.current.pinnedKeys;

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'nerve:agent-colors' }));
    });

    expect(result.current.pinnedKeys).toBe(before);
  });

  it('persists a toggle and reads it back after the page forgets its copy', () => {
    togglePinnedSessionKey('agent:ops:subagent:worker');
    resetPinnedSessionsCache();
    expect(loadPinnedSessions()).toEqual(['agent:ops:subagent:worker']);
  });

  it('unpins deleted sessions and leaves storage alone when none of them was pinned', () => {
    togglePinnedSessionKey('agent:ops:main');
    togglePinnedSessionKey('agent:ops:subagent:worker');

    unpinSessions(['agent:ops:subagent:worker', 'agent:ops:subagent:helper']);
    expect(loadPinnedSessions()).toEqual(['agent:ops:main']);

    localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, 'left as is');
    unpinSessions(['agent:ops:subagent:never-pinned']);
    expect(localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY)).toBe('left as is');
  });
});

describe('pinned order in the session tree', () => {
  const sessions = [
    session('agent:main:main', { label: 'Main' }),
    session('agent:alpha:main', { label: 'Alpha' }),
    session('agent:beta:main', { label: 'Beta' }),
    session('agent:gamma:main', { label: 'Gamma' }),
    session('agent:beta:subagent:a', { label: 'A worker' }),
    session('agent:beta:subagent:b', { label: 'B worker' }),
    session('agent:beta:subagent:c', { label: 'C worker' }),
    session('agent:beta:subagent:c2', { label: 'C helper', parentSessionKey: 'agent:beta:subagent:c' }),
  ];

  it('gives the same tree as before when nothing is pinned', () => {
    expect(buildAgentSidebarTree(sessions, { pinnedKeys: new Set() })).toEqual(buildAgentSidebarTree(sessions));
    expect(buildSessionTree(sessions, { pinnedKeys: new Set() })).toEqual(buildSessionTree(sessions));
  });

  it('moves a pinned root above the others, main included, and keeps the rest in order', () => {
    const roots = buildAgentSidebarTree(sessions, { pinnedKeys: new Set(['agent:gamma:main']) });
    expect(roots.map((root) => root.key)).toEqual(['agent:gamma:main', 'agent:main:main', 'agent:alpha:main', 'agent:beta:main']);
  });

  it('keeps pinned roots in their usual order among themselves', () => {
    const roots = buildAgentSidebarTree(sessions, { pinnedKeys: new Set(['agent:gamma:main', 'agent:alpha:main']) });
    expect(roots.map((root) => root.key)).toEqual(['agent:alpha:main', 'agent:gamma:main', 'agent:main:main', 'agent:beta:main']);
  });

  it('moves a pinned child to the top of its parent and keeps it, and its own children, in place in the tree', () => {
    const plain = shape(buildAgentSidebarTree(sessions));
    const pinned = shape(buildAgentSidebarTree(sessions, { pinnedKeys: new Set(['agent:beta:subagent:c']) }));

    const beta = buildAgentSidebarTree(sessions, { pinnedKeys: new Set(['agent:beta:subagent:c']) })
      .find((root) => root.key === 'agent:beta:main')!;
    expect(beta.children.map((child) => child.key)).toEqual(['agent:beta:subagent:c', 'agent:beta:subagent:a', 'agent:beta:subagent:b']);
    expect(beta.children[0].children.map((child) => child.key)).toEqual(['agent:beta:subagent:c2']);

    // Same rows, same parents and depths: only the sibling order moved
    const byKey = (rows: typeof plain) => [...rows].sort((a, b) => a.key.localeCompare(b.key));
    expect(byKey(pinned)).toEqual(byKey(plain));
    expect(pinned).toHaveLength(sessions.length);
  });

  it('takes effect for a pinned session that was missing and comes back', () => {
    const pinnedKeys = new Set(['agent:beta:subagent:b']);
    const withoutB = sessions.filter((s) => s.sessionKey !== 'agent:beta:subagent:b');

    const before = buildAgentSidebarTree(withoutB, { pinnedKeys }).find((root) => root.key === 'agent:beta:main')!;
    expect(before.children.map((child) => child.key)).toEqual(['agent:beta:subagent:a', 'agent:beta:subagent:c']);

    const after = buildAgentSidebarTree(sessions, { pinnedKeys }).find((root) => root.key === 'agent:beta:main')!;
    expect(after.children.map((child) => child.key)).toEqual(['agent:beta:subagent:b', 'agent:beta:subagent:a', 'agent:beta:subagent:c']);
  });
});
