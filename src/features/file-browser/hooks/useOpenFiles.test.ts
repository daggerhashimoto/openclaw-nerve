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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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

  it('preserves dirty file state for each agent when switching away and back', async () => {
    const { store, mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
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

      if (path === 'draft.md' && agentId === 'main') {
        return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
      }

      if (path === 'notes.md' && agentId === 'research') {
        return createJsonResponse({ ok: true, content: 'research original', mtime: 22 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main original',
        savedContent: 'main original',
        dirty: false,
      });
      expect(result.current.activeTab).toBe('draft.md');
    });

    act(() => {
      result.current.updateContent('draft.md', 'main unsaved draft');
    });

    expect(result.current.openFiles[0]).toMatchObject({
      path: 'draft.md',
      content: 'main unsaved draft',
      savedContent: 'main original',
      dirty: true,
    });
    expect(result.current.hasDirtyFiles).toBe(true);

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        savedContent: 'research original',
        dirty: false,
      });
      expect(result.current.activeTab).toBe('notes.md');
    });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main unsaved draft',
        savedContent: 'main original',
        dirty: true,
      });
      expect(result.current.activeTab).toBe('draft.md');
      expect(result.current.hasDirtyFiles).toBe(true);
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify(['draft.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('draft.md');
  });

  it('remaps late path changes against the originating agent after a switch', async () => {
    const { store, mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['docs/guide.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'docs/guide.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['docs/guide.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'docs/guide.md',
    });
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname !== '/api/files/read') {
        return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
      }

      const path = url.searchParams.get('path');
      const agentId = url.searchParams.get('agentId') || 'main';

      if (path === 'docs/guide.md' && agentId === 'main') {
        return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
      }

      if (path === 'archive/guide.md' && agentId === 'main') {
        return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
      }

      if (path === 'docs/guide.md' && agentId === 'research') {
        return createJsonResponse({ ok: true, content: 'research original', mtime: 22 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'docs/guide.md',
        content: 'main original',
        dirty: false,
      });
      expect(result.current.activeTab).toBe('docs/guide.md');
    });

    act(() => {
      result.current.updateContent('docs/guide.md', 'main draft');
    });

    const staleRemapOpenPaths = result.current.remapOpenPaths;

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'docs/guide.md',
        content: 'research original',
        dirty: false,
      });
      expect(result.current.activeTab).toBe('docs/guide.md');
    });

    act(() => {
      staleRemapOpenPaths('docs', 'archive', 'main');
    });

    expect(result.current.openFiles[0]?.path).toBe('docs/guide.md');
    expect(result.current.activeTab).toBe('docs/guide.md');
    expect(store.get(getWorkspaceStorageKey('open-files', 'research'))).toBe(JSON.stringify(['docs/guide.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'research'))).toBe('docs/guide.md');

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'archive/guide.md',
        content: 'main draft',
        savedContent: 'main original',
        dirty: true,
      });
      expect(result.current.activeTab).toBe('archive/guide.md');
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify(['archive/guide.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('archive/guide.md');
  });

  it('closes late path changes against the originating agent after a switch', async () => {
    const { store, mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['docs/guide.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'docs/guide.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['docs/guide.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'docs/guide.md',
    });
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname !== '/api/files/read') {
        return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
      }

      const path = url.searchParams.get('path');
      const agentId = url.searchParams.get('agentId') || 'main';

      if (path === 'docs/guide.md' && agentId === 'main') {
        return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
      }

      if (path === 'docs/guide.md' && agentId === 'research') {
        return createJsonResponse({ ok: true, content: 'research original', mtime: 22 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['docs/guide.md']);
      expect(result.current.activeTab).toBe('docs/guide.md');
    });

    const staleCloseOpenPathsByPrefix = result.current.closeOpenPathsByPrefix;

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['docs/guide.md']);
      expect(result.current.activeTab).toBe('docs/guide.md');
    });

    act(() => {
      staleCloseOpenPathsByPrefix('docs', 'main');
    });

    expect(result.current.openFiles.map((file) => file.path)).toEqual(['docs/guide.md']);
    expect(result.current.activeTab).toBe('docs/guide.md');
    expect(store.get(getWorkspaceStorageKey('open-files', 'research'))).toBe(JSON.stringify(['docs/guide.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'research'))).toBe('docs/guide.md');

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('chat');
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify([]));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('chat');
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

  it('clears a saved file from the originating agent after switching away before save resolves', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const fileContentsByAgent = new Map<string, Map<string, { content: string; mtime: number }>>([
      ['main', new Map([['draft.md', { content: 'main original', mtime: 11 }]])],
      ['research', new Map([['notes.md', { content: 'research original', mtime: 22 }]])],
    ]);
    const writeRequest = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path') || '';
        const fileEntry = fileContentsByAgent.get(agentId)?.get(path);
        if (fileEntry) {
          return createJsonResponse({ ok: true, ...fileEntry });
        }
      }

      if (url.pathname === '/api/files/write') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          path: string;
          content: string;
          agentId?: string;
        };
        writeRequest.promise.then(() => {
          const agentId = body.agentId || 'main';
          fileContentsByAgent.get(agentId)?.set(body.path, { content: body.content, mtime: 99 });
        });
        return writeRequest.promise;
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main original',
        savedContent: 'main original',
        dirty: false,
        mtime: 11,
      });
    });

    act(() => {
      result.current.updateContent('draft.md', 'main saved draft');
    });

    let savePromise!: Promise<{ ok: boolean; conflict?: boolean }>;
    act(() => {
      savePromise = result.current.saveFile('draft.md');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        dirty: false,
      });
    });

    writeRequest.resolve(createJsonResponse({ ok: true, mtime: 99 }));
    await expect(savePromise).resolves.toEqual({ ok: true });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main saved draft',
        savedContent: 'main saved draft',
        dirty: false,
        mtime: 99,
      });
      expect(result.current.hasDirtyFiles).toBe(false);
    });
  });

  it('keeps discard-all coherent when switching away immediately afterwards', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
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

      if (path === 'draft.md' && agentId === 'main') {
        return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
      }

      if (path === 'notes.md' && agentId === 'research') {
        return createJsonResponse({ ok: true, content: 'research original', mtime: 22 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main original',
        dirty: false,
      });
    });

    act(() => {
      result.current.updateContent('draft.md', 'main unsaved draft');
    });

    expect(result.current.hasDirtyFiles).toBe(true);

    act(() => {
      result.current.discardAllDirtyFiles();
      rerender({ agentId: 'research' });
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        dirty: false,
      });
    });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main original',
        savedContent: 'main original',
        dirty: false,
      });
      expect(result.current.hasDirtyFiles).toBe(false);
      expect(result.current.getDirtyFilePaths()).toEqual([]);
    });
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
