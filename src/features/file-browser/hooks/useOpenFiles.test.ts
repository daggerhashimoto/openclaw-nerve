import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
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

interface OpenFilesRenderSnapshot {
  agentId: string;
  openFilePaths: string[];
  activeTab: string;
  loadingFilePaths: string[];
}

function OpenFilesRenderObserver({
  agentId,
  onRender,
}: {
  agentId: string;
  onRender: (
    snapshot: OpenFilesRenderSnapshot,
    api: ReturnType<typeof useOpenFiles>,
  ) => void;
}) {
  const api = useOpenFiles(agentId);

  onRender({
    agentId,
    openFilePaths: api.openFiles.map((file) => file.path),
    activeTab: api.activeTab,
    loadingFilePaths: api.openFiles.filter((file) => file.loading).map((file) => file.path),
  }, api);

  return null;
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

  it('hides the previous agent tabs on the first render after switching workspaces', async () => {
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
      const requestAgentId = url.searchParams.get('agentId') || 'main';

      if (path === 'main.md' && requestAgentId === 'main') {
        return createJsonResponse({ ok: true, content: '# main', mtime: 11 });
      }

      if (path === 'notes.md' && requestAgentId === 'research') {
        return createJsonResponse({ ok: true, content: '# research', mtime: 22 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const researchSnapshots: OpenFilesRenderSnapshot[] = [];
    let currentApi!: ReturnType<typeof useOpenFiles>;

    const { rerender } = render(createElement(OpenFilesRenderObserver, {
      agentId: 'main',
      onRender: (_, api) => {
        currentApi = api;
      },
    }));

    await waitFor(() => {
      expect(currentApi.openFiles.map((file) => file.path)).toEqual(['main.md']);
      expect(currentApi.activeTab).toBe('main.md');
    });

    rerender(createElement(OpenFilesRenderObserver, {
      agentId: 'research',
      onRender: (snapshot) => {
        researchSnapshots.push(snapshot);
      },
    }));

    expect(researchSnapshots[0]).toMatchObject({
      agentId: 'research',
      openFilePaths: [],
      activeTab: 'notes.md',
      loadingFilePaths: [],
    });

    await waitFor(() => {
      expect(researchSnapshots.at(-1)).toMatchObject({
        agentId: 'research',
        openFilePaths: ['notes.md'],
        activeTab: 'notes.md',
      });
    });
  });

  it('drops late file reads that resolve during the pre-effect switch window', async () => {
    const { mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    const lateRead = createDeferred<Response>();
    const researchSnapshots: OpenFilesRenderSnapshot[] = [];
    let currentApi!: ReturnType<typeof useOpenFiles>;
    let resolveLateReadOnResearchRender = false;
    let resolvedLateRead = false;

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (
        url.pathname === '/api/files/read'
        && url.searchParams.get('path') === 'late.md'
        && (url.searchParams.get('agentId') || 'main') === 'main'
      ) {
        return lateRead.promise;
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { rerender } = render(createElement(OpenFilesRenderObserver, {
      agentId: 'main',
      onRender: (snapshot, api) => {
        currentApi = api;
        if (snapshot.agentId === 'research') {
          researchSnapshots.push(snapshot);
          if (resolveLateReadOnResearchRender && !resolvedLateRead) {
            resolvedLateRead = true;
            lateRead.resolve(createJsonResponse({ ok: true, content: 'late main', mtime: 7 }));
          }
        }
      },
    }));

    act(() => {
      void currentApi.openFile('late.md');
    });

    await waitFor(() => {
      expect(currentApi.openFiles.map((file) => file.path)).toEqual(['late.md']);
      expect(currentApi.openFiles[0]?.loading).toBe(true);
    });

    resolveLateReadOnResearchRender = true;

    await act(async () => {
      rerender(createElement(OpenFilesRenderObserver, {
        agentId: 'research',
        onRender: (snapshot, api) => {
          currentApi = api;
          researchSnapshots.push(snapshot);
          if (resolveLateReadOnResearchRender && !resolvedLateRead) {
            resolvedLateRead = true;
            lateRead.resolve(createJsonResponse({ ok: true, content: 'late main', mtime: 7 }));
          }
        },
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(researchSnapshots[0]).toMatchObject({
      agentId: 'research',
      openFilePaths: [],
      activeTab: 'chat',
      loadingFilePaths: [],
    });
    expect(researchSnapshots.some((snapshot) => snapshot.openFilePaths.includes('late.md'))).toBe(false);
    expect(currentApi.openFiles).toEqual([]);
    expect(currentApi.activeTab).toBe('chat');
  });

  it('keeps a tab opened and edited during restore when the delayed restore commit lands', async () => {
    const { store, mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['restored.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'restored.md',
    });
    vi.stubGlobal('localStorage', mock);

    const restoredRead = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname !== '/api/files/read') {
        return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
      }

      const path = url.searchParams.get('path');
      if (path === 'restored.md') {
        return restoredRead.promise;
      }

      if (path === 'manual.md') {
        return createJsonResponse({ ok: true, content: 'manual original', mtime: 2 });
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    expect(result.current.openFiles).toEqual([]);
    expect(result.current.activeTab).toBe('restored.md');

    await act(async () => {
      await result.current.openFile('manual.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles).toHaveLength(1);
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'manual.md',
        content: 'manual original',
        savedContent: 'manual original',
        dirty: false,
        loading: false,
      });
      expect(result.current.activeTab).toBe('manual.md');
    });

    act(() => {
      result.current.updateContent('manual.md', 'manual dirty');
    });

    expect(result.current.hasDirtyFiles).toBe(true);
    expect(result.current.getDirtyFilePaths()).toEqual(['manual.md']);

    await act(async () => {
      restoredRead.resolve(createJsonResponse({ ok: true, content: 'restored original', mtime: 1 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['restored.md', 'manual.md']);
      expect(result.current.openFiles.find((file) => file.path === 'restored.md')).toMatchObject({
        content: 'restored original',
        savedContent: 'restored original',
        dirty: false,
      });
      expect(result.current.openFiles.find((file) => file.path === 'manual.md')).toMatchObject({
        content: 'manual dirty',
        savedContent: 'manual original',
        dirty: true,
      });
      expect(result.current.activeTab).toBe('manual.md');
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['manual.md']);
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify(['restored.md', 'manual.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('manual.md');
  });

  it('reports dirty restored files through helper accessors while restore is still loading', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainRestoreRead = createDeferred<Response>();
    const readQueues = new Map<string, Array<Response | Promise<Response>>>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainRestoreRead.promise,
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
      ]],
    ]);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const nextResponse = readQueues.get(agentId)?.shift();
        if (nextResponse) {
          return await nextResponse;
        }
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
    });

    act(() => {
      result.current.updateContent('draft.md', 'main unsaved draft');
    });

    expect(result.current.hasDirtyFiles).toBe(true);
    expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        dirty: false,
      });
    });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('draft.md');
    });

    expect(result.current.hasDirtyFiles).toBe(true);
    expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);

    await act(async () => {
      mainRestoreRead.resolve(createJsonResponse({ ok: true, content: 'main original', mtime: 11 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main unsaved draft',
        savedContent: 'main original',
        dirty: true,
      });
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });
  });

  it('saves dirty restored files through helper actions while restore is still loading', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainRestoreRead = createDeferred<Response>();
    const writeBodies: Array<{
      path: string;
      content: string;
      expectedMtime: number;
      agentId?: string;
    }> = [];
    const readQueues = new Map<string, Array<Response | Promise<Response>>>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainRestoreRead.promise,
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
      ]],
    ]);

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const nextResponse = readQueues.get(agentId)?.shift();
        if (nextResponse) {
          return await nextResponse;
        }
      }

      if (url.pathname === '/api/files/write') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          path: string;
          content: string;
          expectedMtime: number;
          agentId?: string;
        };
        writeBodies.push(body);
        return createJsonResponse({ ok: true, mtime: 99 });
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
    });

    act(() => {
      result.current.updateContent('draft.md', 'main unsaved draft');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        dirty: false,
      });
    });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('draft.md');
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });

    let saveAllResult!: { ok: boolean; failedPath?: string; conflict?: boolean };
    await act(async () => {
      saveAllResult = await result.current.saveAllDirtyFiles();
    });

    expect(saveAllResult).toEqual({ ok: true });
    expect(writeBodies).toEqual([{
      path: 'draft.md',
      content: 'main unsaved draft',
      expectedMtime: 11,
      agentId: 'main',
    }]);

    await waitFor(() => {
      expect(result.current.hasDirtyFiles).toBe(false);
      expect(result.current.getDirtyFilePaths()).toEqual([]);
    });

    await act(async () => {
      mainRestoreRead.resolve(createJsonResponse({ ok: true, content: 'main unsaved draft', mtime: 99 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main unsaved draft',
        savedContent: 'main unsaved draft',
        dirty: false,
        mtime: 99,
      });
      expect(result.current.hasDirtyFiles).toBe(false);
      expect(result.current.getDirtyFilePaths()).toEqual([]);
    });
  });

  it('discards dirty restored files without mutating the previous agent while restore is still loading', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainRestoreRead = createDeferred<Response>();
    const readQueues = new Map<string, Array<Response | Promise<Response>>>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainRestoreRead.promise,
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
      ]],
    ]);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const nextResponse = readQueues.get(agentId)?.shift();
        if (nextResponse) {
          return await nextResponse;
        }
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
    });

    act(() => {
      result.current.updateContent('draft.md', 'main unsaved draft');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        savedContent: 'research original',
        dirty: false,
      });
    });

    act(() => {
      result.current.updateContent('notes.md', 'research unsaved note');
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research unsaved note',
        savedContent: 'research original',
        dirty: true,
      });
    });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('draft.md');
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });

    act(() => {
      result.current.discardAllDirtyFiles();
    });

    await waitFor(() => {
      expect(result.current.hasDirtyFiles).toBe(false);
      expect(result.current.getDirtyFilePaths()).toEqual([]);
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research unsaved note',
        savedContent: 'research original',
        dirty: true,
      });
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['notes.md']);
    });

    await act(async () => {
      mainRestoreRead.resolve(createJsonResponse({ ok: true, content: 'main original', mtime: 11 }));
      await Promise.resolve();
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

  it('keeps dirty restored files when the reread fails during switch-back restore', async () => {
    const { store, mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainRestoreRead = createDeferred<Response>();
    const readQueues = new Map<string, Array<Response | Promise<Response>>>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainRestoreRead.promise,
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
      ]],
    ]);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const nextResponse = readQueues.get(agentId)?.shift();
        if (nextResponse) {
          return await nextResponse;
        }
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
    });

    act(() => {
      result.current.updateContent('draft.md', 'main unsaved draft');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        dirty: false,
      });
    });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('draft.md');
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });

    await act(async () => {
      mainRestoreRead.resolve(createJsonResponse(
        { ok: false, error: 'transient reread failure' },
        { ok: false, status: 500 },
      ));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main unsaved draft',
        savedContent: 'main original',
        dirty: true,
        loading: false,
      });
      expect(result.current.activeTab).toBe('draft.md');
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify(['draft.md']));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('draft.md');
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

  it('saves all dirty files sequentially', async () => {
    const { mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    const firstWrite = createDeferred<Response>();
    const writePaths: string[] = [];

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const path = url.searchParams.get('path');
        if (path === 'first.md') {
          return createJsonResponse({ ok: true, content: 'first original', mtime: 1 });
        }
        if (path === 'second.md') {
          return createJsonResponse({ ok: true, content: 'second original', mtime: 2 });
        }
      }

      if (url.pathname === '/api/files/write') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { path: string };
        writePaths.push(body.path);

        if (body.path === 'first.md') {
          return firstWrite.promise;
        }
        if (body.path === 'second.md') {
          return createJsonResponse({ ok: true, mtime: 22 });
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await act(async () => {
      await result.current.openFile('first.md');
      await result.current.openFile('second.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles.map((file) => file.path)).toEqual(['first.md', 'second.md']);
    });

    act(() => {
      result.current.updateContent('first.md', 'first draft');
      result.current.updateContent('second.md', 'second draft');
    });

    let saveAllResult!: { ok: boolean; failedPath?: string; conflict?: boolean };
    act(() => {
      void result.current.saveAllDirtyFiles().then((value) => {
        saveAllResult = value;
      });
    });

    await waitFor(() => {
      expect(writePaths).toEqual(['first.md']);
    });

    await act(async () => {
      firstWrite.resolve(createJsonResponse({ ok: true, mtime: 11 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(writePaths).toEqual(['first.md', 'second.md']);
      expect(saveAllResult).toEqual({ ok: true });
    });
  });

  it('stops save-all on the first failure and returns the failed path', async () => {
    const { mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    const writePaths: string[] = [];

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const path = url.searchParams.get('path');
        if (path === 'first.md') {
          return createJsonResponse({ ok: true, content: 'first original', mtime: 1 });
        }
        if (path === 'second.md') {
          return createJsonResponse({ ok: true, content: 'second original', mtime: 2 });
        }
      }

      if (url.pathname === '/api/files/write') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { path: string };
        writePaths.push(body.path);

        if (body.path === 'first.md') {
          return createJsonResponse({ ok: false, error: 'write failed' }, { ok: false, status: 500 });
        }
        if (body.path === 'second.md') {
          return createJsonResponse({ ok: true, mtime: 22 });
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await act(async () => {
      await result.current.openFile('first.md');
      await result.current.openFile('second.md');
    });

    act(() => {
      result.current.updateContent('first.md', 'first draft');
      result.current.updateContent('second.md', 'second draft');
    });

    let saveAllResult!: { ok: boolean; failedPath?: string; conflict?: boolean };
    await act(async () => {
      saveAllResult = await result.current.saveAllDirtyFiles();
    });

    expect(writePaths).toEqual(['first.md']);
    expect(saveAllResult).toEqual({ ok: false, failedPath: 'first.md', conflict: undefined });
  });

  it('returns conflict details from save-all when the first save hits a 409', async () => {
    const { mock } = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);

    const writePaths: string[] = [];

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const path = url.searchParams.get('path');
        if (path === 'first.md') {
          return createJsonResponse({ ok: true, content: 'first original', mtime: 1 });
        }
        if (path === 'second.md') {
          return createJsonResponse({ ok: true, content: 'second original', mtime: 2 });
        }
      }

      if (url.pathname === '/api/files/write') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { path: string };
        writePaths.push(body.path);

        if (body.path === 'first.md') {
          return createJsonResponse({ ok: false, error: 'File was modified since you loaded it' }, { ok: false, status: 409 });
        }
        if (body.path === 'second.md') {
          return createJsonResponse({ ok: true, mtime: 22 });
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await act(async () => {
      await result.current.openFile('first.md');
      await result.current.openFile('second.md');
    });

    act(() => {
      result.current.updateContent('first.md', 'first draft');
      result.current.updateContent('second.md', 'second draft');
    });

    let saveAllResult!: { ok: boolean; failedPath?: string; conflict?: boolean };
    await act(async () => {
      saveAllResult = await result.current.saveAllDirtyFiles();
    });

    expect(writePaths).toEqual(['first.md']);
    expect(saveAllResult).toEqual({ ok: false, failedPath: 'first.md', conflict: true });
  });

  it('keeps later edits dirty when a save resolves after more typing in the same workspace', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
    });
    vi.stubGlobal('localStorage', mock);

    const writeRequest = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const path = url.searchParams.get('path');
        if (path === 'draft.md') {
          return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
        }
      }

      if (url.pathname === '/api/files/write') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          path: string;
          content: string;
          expectedMtime: number;
        };

        expect(body).toMatchObject({
          path: 'draft.md',
          content: 'main saved draft',
          expectedMtime: 11,
        });

        return writeRequest.promise;
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

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

    act(() => {
      result.current.updateContent('draft.md', 'main later edit');
    });

    await act(async () => {
      writeRequest.resolve(createJsonResponse({ ok: true, mtime: 99 }));
      await Promise.resolve();
    });

    await expect(savePromise).resolves.toEqual({ ok: true });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main later edit',
        savedContent: 'main saved draft',
        dirty: true,
        mtime: 99,
      });
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });
  });

  it('preserves later unsaved edits after switching away before the save resolves', async () => {
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

        expect(body).toMatchObject({
          path: 'draft.md',
          content: 'main saved draft',
          agentId: 'main',
        });

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

    act(() => {
      result.current.updateContent('draft.md', 'main later edit');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'notes.md',
        content: 'research original',
        dirty: false,
      });
    });

    await act(async () => {
      writeRequest.resolve(createJsonResponse({ ok: true, mtime: 99 }));
      await Promise.resolve();
    });

    await expect(savePromise).resolves.toEqual({ ok: true });

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main later edit',
        savedContent: 'main saved draft',
        dirty: true,
        mtime: 99,
      });
      expect(result.current.hasDirtyFiles).toBe(true);
      expect(result.current.getDirtyFilePaths()).toEqual(['draft.md']);
    });
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


  it('keeps own-save bounce-back suppressed after switching away and back before save resolves', async () => {
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
    let pendingWriteBody: { path: string; content: string; agentId?: string } | null = null;

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
        pendingWriteBody = JSON.parse(String(init?.body ?? '{}')) as {
          path: string;
          content: string;
          agentId?: string;
        };
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

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main saved draft',
        savedContent: 'main original',
        dirty: true,
        mtime: 11,
      });
    });

    expect(pendingWriteBody).toMatchObject({
      path: 'draft.md',
      content: 'main saved draft',
      agentId: 'main',
    });

    fileContentsByAgent.get('main')?.set('draft.md', { content: 'main saved draft', mtime: 99 });

    await act(async () => {
      result.current.handleFileChanged('draft.md');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.openFiles[0]).toMatchObject({
      path: 'draft.md',
      content: 'main saved draft',
      savedContent: 'main original',
      dirty: true,
      locked: false,
      mtime: 11,
    });

    await act(async () => {
      writeRequest.resolve(createJsonResponse({ ok: true, mtime: 99 }));
      await Promise.resolve();
    });

    await expect(savePromise).resolves.toEqual({ ok: true });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'main saved draft',
        savedContent: 'main saved draft',
        dirty: false,
        locked: false,
        mtime: 99,
      });
    });
  });

  it('does not resurrect dirty state when a restore overlaps a save that resolves after switching away and back', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainRestoreRead = createDeferred<Response>();
    const readQueues = new Map<string, Array<Response | Promise<Response>>>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainRestoreRead.promise,
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
      ]],
    ]);
    const writeRequest = createDeferred<Response>();

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const nextResponse = readQueues.get(agentId)?.shift();
        if (nextResponse) {
          return await nextResponse;
        }
      }

      if (url.pathname === '/api/files/write') {
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

    rerender({ agentId: 'main' });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('draft.md');
    });

    await act(async () => {
      writeRequest.resolve(createJsonResponse({ ok: true, mtime: 99 }));
      await Promise.resolve();
    });

    await expect(savePromise).resolves.toEqual({ ok: true });

    await act(async () => {
      mainRestoreRead.resolve(createJsonResponse({ ok: true, content: 'main saved draft', mtime: 99 }));
      await Promise.resolve();
    });

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

  it('keeps recent save suppression scoped when two agents share the same relative path', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'shared.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'shared.md',
    });
    vi.stubGlobal('localStorage', mock);

    const fileContentsByAgent = new Map<string, Map<string, { content: string; mtime: number }>>([
      ['main', new Map([['shared.md', { content: 'main original', mtime: 11 }]])],
      ['research', new Map([['shared.md', { content: 'research original', mtime: 22 }]])],
    ]);
    const mainWrite = createDeferred<Response>();

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

        if (body.agentId === 'main') {
          mainWrite.promise.then(() => {
            fileContentsByAgent.get('main')?.set(body.path, { content: body.content, mtime: 99 });
          });
          return mainWrite.promise;
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'main original',
        dirty: false,
      });
    });

    act(() => {
      result.current.updateContent('shared.md', 'main saved draft');
    });

    let mainSavePromise!: Promise<{ ok: boolean; conflict?: boolean }>;
    act(() => {
      mainSavePromise = result.current.saveFile('shared.md');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'research original',
        dirty: false,
      });
    });

    fileContentsByAgent.get('research')?.set('shared.md', {
      content: 'research changed on disk',
      mtime: 33,
    });

    await act(async () => {
      mainWrite.resolve(createJsonResponse({ ok: true, mtime: 99 }));
      await Promise.resolve();
    });

    await expect(mainSavePromise).resolves.toEqual({ ok: true });

    act(() => {
      result.current.handleFileChanged('shared.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'research changed on disk',
        savedContent: 'research changed on disk',
        dirty: false,
        mtime: 33,
      });
    });
  });

  it('ignores file.changed events explicitly targeted at a different agent after a workspace switch', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'shared.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'shared.md',
    });
    vi.stubGlobal('localStorage', mock);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path') || '';

        if (path === 'shared.md' && agentId === 'main') {
          return createJsonResponse({ ok: true, content: 'main original', mtime: 11 });
        }

        if (path === 'shared.md' && agentId === 'research') {
          return createJsonResponse({ ok: true, content: 'research original', mtime: 22 });
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'main original',
        dirty: false,
      });
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'research original',
        dirty: false,
        locked: false,
      });
    });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    await act(async () => {
      (result.current.handleFileChanged as unknown as (path: string, targetAgentId?: string) => void)('shared.md', 'main');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.openFiles[0]).toMatchObject({
      path: 'shared.md',
      content: 'research original',
      savedContent: 'research original',
      dirty: false,
      locked: false,
      mtime: 22,
    });
  });

  it('keeps in-flight save suppression scoped when two agents save the same relative path', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'shared.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'shared.md',
    });
    vi.stubGlobal('localStorage', mock);

    const fileContentsByAgent = new Map<string, Map<string, { content: string; mtime: number }>>([
      ['main', new Map([['shared.md', { content: 'main original', mtime: 11 }]])],
      ['research', new Map([['shared.md', { content: 'research original', mtime: 22 }]])],
    ]);
    const mainWrite = createDeferred<Response>();
    const researchWrite = createDeferred<Response>();

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

        if (body.agentId === 'main') {
          return mainWrite.promise;
        }

        if (body.agentId === 'research') {
          researchWrite.promise.then(() => {
            fileContentsByAgent.get('research')?.set(body.path, { content: body.content, mtime: 44 });
          });
          return researchWrite.promise;
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'main original',
      });
    });

    act(() => {
      result.current.updateContent('shared.md', 'main draft');
    });

    let mainSavePromise!: Promise<{ ok: boolean; conflict?: boolean }>;
    act(() => {
      mainSavePromise = result.current.saveFile('shared.md');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'research original',
        dirty: false,
      });
    });

    act(() => {
      result.current.updateContent('shared.md', 'research draft');
    });

    let researchSavePromise!: Promise<{ ok: boolean; conflict?: boolean }>;
    act(() => {
      researchSavePromise = result.current.saveFile('shared.md');
    });

    await act(async () => {
      mainWrite.resolve(createJsonResponse(
        { ok: false, error: 'write failed' },
        { ok: false, status: 500 },
      ));
      await Promise.resolve();
    });

    await expect(mainSavePromise).resolves.toEqual({ ok: false });

    act(() => {
      result.current.handleFileChanged('shared.md');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.openFiles[0]).toMatchObject({
      path: 'shared.md',
      content: 'research draft',
      savedContent: 'research original',
      dirty: true,
      locked: false,
    });

    await act(async () => {
      researchWrite.resolve(createJsonResponse({ ok: true, mtime: 44 }));
      await Promise.resolve();
    });

    await expect(researchSavePromise).resolves.toEqual({ ok: true });
  });

  it('keeps unlock timers scoped when late reloads resolve after switching agents with the same relative path', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'shared.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['shared.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'shared.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainReload = createDeferred<Response>();
    const readQueues = new Map<string, Response[] | Promise<Response>[]>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainReload.promise,
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
        createJsonResponse({ ok: true, content: 'research changed on disk', mtime: 23 }),
      ]],
    ]);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);

      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const nextResponse = readQueues.get(agentId)?.shift();
        if (nextResponse) {
          return await nextResponse;
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'main original',
      });
    });

    act(() => {
      result.current.handleFileChanged('shared.md');
    });

    rerender({ agentId: 'research' });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'research original',
        dirty: false,
      });
    });

    vi.useFakeTimers();
    try {
      await act(async () => {
        result.current.handleFileChanged('shared.md');
        await Promise.resolve();
      });

      expect(result.current.openFiles[0]).toMatchObject({
        path: 'shared.md',
        content: 'research changed on disk',
        savedContent: 'research changed on disk',
        locked: true,
        dirty: false,
        mtime: 23,
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        mainReload.resolve(createJsonResponse({ ok: true, content: 'main reloaded', mtime: 12 }));
        await Promise.resolve();
      });

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(result.current.openFiles[0]?.locked).toBe(false);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('ignores stale reloads when a newer read for the same agent and path already completed', async () => {
    const { mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['draft.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'draft.md',
    });
    vi.stubGlobal('localStorage', mock);

    const olderReload = createDeferred<Response>();
    const readQueue: Array<Response | Promise<Response>> = [
      createJsonResponse({ ok: true, content: 'initial', mtime: 1 }),
      olderReload.promise,
      createJsonResponse({ ok: true, content: 'fresh', mtime: 3 }),
    ];

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/files/read' && url.searchParams.get('path') === 'draft.md') {
        const next = readQueue.shift();
        if (next) return await next;
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result } = renderHook(() => useOpenFiles('main'));

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'initial',
        savedContent: 'initial',
        dirty: false,
        mtime: 1,
      });
    });

    act(() => {
      void result.current.reloadFile('draft.md');
      void result.current.reloadFile('draft.md');
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'fresh',
        savedContent: 'fresh',
        dirty: false,
        mtime: 3,
      });
    });

    await act(async () => {
      olderReload.resolve(createJsonResponse({ ok: true, content: 'stale', mtime: 2 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'draft.md',
        content: 'fresh',
        savedContent: 'fresh',
        dirty: false,
        mtime: 3,
      });
    });
  });

  it('applies close-path updates to the state owner while a switch-back restore is still loading', async () => {
    const { store, mock } = createLocalStorageMock({
      [getWorkspaceStorageKey('open-files', 'main')]: JSON.stringify(['docs/main.md']),
      [getWorkspaceStorageKey('active-tab', 'main')]: 'docs/main.md',
      [getWorkspaceStorageKey('open-files', 'research')]: JSON.stringify(['notes.md']),
      [getWorkspaceStorageKey('active-tab', 'research')]: 'notes.md',
    });
    vi.stubGlobal('localStorage', mock);

    const mainSwitchBackRestore = createDeferred<Response>();
    const readQueues = new Map<string, Array<Response | Promise<Response>>>([
      ['main', [
        createJsonResponse({ ok: true, content: 'main original', mtime: 11 }),
        mainSwitchBackRestore.promise,
      ]],
      ['research', [
        createJsonResponse({ ok: true, content: 'research original', mtime: 22 }),
      ]],
    ]);

    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = getRequestUrl(input);
      if (url.pathname === '/api/files/read') {
        const agentId = url.searchParams.get('agentId') || 'main';
        const next = readQueues.get(agentId)?.shift();
        if (next) {
          return await next;
        }
      }

      return createJsonResponse({ ok: false, error: 'Not found' }, { ok: false, status: 404 });
    });

    const { result, rerender } = renderHook(
      ({ agentId }) => useOpenFiles(agentId),
      { initialProps: { agentId: 'main' } },
    );

    await waitFor(() => {
      expect(result.current.openFiles[0]).toMatchObject({
        path: 'docs/main.md',
        content: 'main original',
        savedContent: 'main original',
        dirty: false,
      });
      expect(result.current.activeTab).toBe('docs/main.md');
    });

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
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('docs/main.md');
    });

    act(() => {
      result.current.closeOpenPathsByPrefix('docs', 'main');
    });

    await act(async () => {
      mainSwitchBackRestore.resolve(createJsonResponse({ ok: true, content: 'main original', mtime: 11 }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.openFiles).toEqual([]);
      expect(result.current.activeTab).toBe('chat');
      expect(result.current.hasDirtyFiles).toBe(false);
      expect(result.current.getDirtyFilePaths()).toEqual([]);
    });

    expect(store.get(getWorkspaceStorageKey('open-files', 'main'))).toBe(JSON.stringify([]));
    expect(store.get(getWorkspaceStorageKey('active-tab', 'main'))).toBe('chat');
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
