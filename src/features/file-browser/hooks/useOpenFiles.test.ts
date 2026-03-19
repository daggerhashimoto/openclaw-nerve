import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenFiles } from './useOpenFiles';
import { getWorkspaceStorageKey } from '@/features/workspace/workspaceScope';

function createJsonResponse(data: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as Response;
}

function createLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  return {
    store,
    mock: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
    },
  };
}

function getRequestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://localhost');
  if (input instanceof URL) return new URL(input.toString(), 'http://localhost');
  return new URL(input.url, 'http://localhost');
}

describe('useOpenFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persists open tabs under agent-scoped keys', async () => {
    const { store, mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/files/read' && url.searchParams.get('path') === 'main.md') {
        return createJsonResponse({ ok: true, content: '# main', mtime: 1 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await act(async () => {
      await result.current.openFile('main.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['main.md']);
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify(['main.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('main.md');
    expect(store.has('nerve-open-files')).toBe(false);
    expect(store.has('nerve-active-tab')).toBe(false);
  });

  it('restores each agent\'s tab set when the agent id changes', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['main.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'main.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname !== '/api/files/read') {
        return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
      }

      const path = url.searchParams.get('path');
      const agentId = url.searchParams.get('agentId') || 'main';

      if (path === 'main.md' && agentId === 'main') {
        return createJsonResponse({ ok: true, content: '# main', mtime: 11 });
      }

      if (path === 'notes.md' && agentId === 'research') {
        return createJsonResponse({ ok: true, content: '# research', mtime: 22 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['main.md']);
      expect(result.current.activeTab).toBe('main.md');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['notes.md']);
      expect(result.current.activeTab).toBe('notes.md');
    });

    expect(result.current.openFiles.some((file) => file.path === 'main.md')).toBe(false);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('agentId=main'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('agentId=research'));
  });

  it('reports dirty files through helper accessors', async () => {
    const { mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/files/read' && url.searchParams.get('path') === 'draft.md') {
        return createJsonResponse({ ok: true, content: 'original', mtime: 1 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await act(async () => {
      await result.current.openFile('draft.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
    });

    act(() => {
      result.current.updateContent('draft.md', 'changed');
    });

    expect(result.current.hasDirtyFiles).toBe(true);
    expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
  });

  it('discards dirty files back to their saved content', async () => {
    const { mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/files/read' && url.searchParams.get('path') === 'draft.md') {
        return createJsonResponse({ ok: true, content: 'original', mtime: 1 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await act(async () => {
      await result.current.openFile('draft.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]?.content).toBe('original');
    });

    act(() => {
      result.current.updateContent('draft.md', 'changed');
    });

    act(() => {
      result.current.discardAllDirtyFiles();
    });

    expect(result.current.hasDirtyFiles).toBe(false);
    expect(result.current.getDirtyFilePaths()).toEqual([]);
    expect(result.current.openFiles[0]).toMatchObject({
      path: 'draft.md',
      content: 'original',
      savedContent: 'original',
      dirty: false,
    });
  });
});
