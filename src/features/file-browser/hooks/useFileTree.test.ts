/** Tests for useFileTree hook - workspace info handling and tree operations. */
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { useFileTree } from './useFileTree';
import type { TreeEntry } from '../types';
import { getWorkspaceStorageKey } from '@/features/workspace/workspaceScope';

// Mock fetch globally
global.fetch = vi.fn();

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

interface FileTreeRenderSnapshot {
  agentId: string;
  entryPaths: string[];
  expandedPaths: string[];
  selectedPath: string | null;
  loading: boolean;
  loadingPaths: string[];
  workspaceRoot: string | null;
}

function FileTreeRenderObserver({
  agentId,
  onRender,
}: {
  agentId: string;
  onRender: (
    snapshot: FileTreeRenderSnapshot,
    api: ReturnType<typeof useFileTree>,
  ) => void;
}) {
  const api = useFileTree(agentId);

  onRender({
    agentId,
    entryPaths: api.entries.map((entry) => entry.path),
    expandedPaths: [...api.expandedPaths].sort(),
    selectedPath: api.selectedPath,
    loading: api.loading,
    loadingPaths: [...api.loadingPaths].sort(),
    workspaceRoot: api.workspaceInfo?.rootPath ?? null,
  }, api);

  return null;
}

describe('useFileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('workspace info handling', () => {
    it('initializes with null workspaceInfo', () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, entries: [] }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      expect(result.current.workspaceInfo).toBeNull();
    });

    it('sets workspaceInfo when API response includes it', async () => {
      const mockWorkspaceInfo = {
        isCustomWorkspace: true,
        rootPath: '/home/user/custom-workspace',
      };

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'file.txt', path: 'file.txt', type: 'file' as const, children: null },
          ],
          workspaceInfo: mockWorkspaceInfo,
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.workspaceInfo).toEqual(mockWorkspaceInfo);
      });
    });

    it('sets workspaceInfo with default workspace when not using custom workspace', async () => {
      const mockWorkspaceInfo = {
        isCustomWorkspace: false,
        rootPath: '/home/user/.openclaw/workspace',
      };

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory' as const, children: null },
          ],
          workspaceInfo: mockWorkspaceInfo,
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.workspaceInfo).toEqual(mockWorkspaceInfo);
      });
    });

    it('handles API response without workspaceInfo gracefully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'package.json', path: 'package.json', type: 'file' as const, children: null },
          ],
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
        expect(result.current.workspaceInfo).toBeNull();
      });
    });

    it('updates workspaceInfo when subsequent calls return different info', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // First call - custom workspace
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
          workspaceInfo: {
            isCustomWorkspace: true,
            rootPath: '/custom/path',
          },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.workspaceInfo?.isCustomWorkspace).toBe(true);
      });

      // Second call - default workspace
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
          workspaceInfo: {
            isCustomWorkspace: false,
            rootPath: '/default/path',
          },
        }),
      } as Response);

      // Trigger a refresh
      result.current.refresh();

      await waitFor(() => {
        expect(result.current.workspaceInfo?.isCustomWorkspace).toBe(false);
        expect(result.current.workspaceInfo?.rootPath).toBe('/default/path');
      });
    });
  });

  describe('existing functionality still works', () => {
    it('loads entries on mount', async () => {
      const mockEntries: TreeEntry[] = [
        { name: 'src', path: 'src', type: 'directory', children: null },
        { name: 'package.json', path: 'package.json', type: 'file', children: null },
      ];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: mockEntries,
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries).toEqual(mockEntries);
      });
    });

    it('handles fetch errors gracefully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    });

    it('handles API error responses', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries).toEqual([]);
      });
    });

    it('toggles directory expansion', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
      });

      // Toggle directory
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'index.ts', path: 'src/index.ts', type: 'file', children: null },
          ],
        }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('path=src')
        );
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('agentId=main')
        );
      });
    });

    it('selects files', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'test.txt', path: 'test.txt', type: 'file', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.entries).toHaveLength(1);
      });

      result.current.selectFile('test.txt');
      // Test that the function can be called without throwing
      expect(typeof result.current.selectFile).toBe('function');
    });

    it('persists expanded paths in localStorage', async () => {
      const mockLocalStorage = vi.mocked(localStorage);
      mockLocalStorage.getItem.mockReturnValue('["src","components"]');

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      renderHook(() => useFileTree('main'));

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(getWorkspaceStorageKey('file-tree-expanded', 'main'));
    });
  });

  describe('return object includes workspaceInfo', () => {
    it('exports workspaceInfo in the return object', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
          workspaceInfo: { isCustomWorkspace: true, rootPath: '/custom' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      // Check that workspaceInfo is in the return object
      expect('workspaceInfo' in result.current).toBe(true);
      expect(result.current.workspaceInfo).toBeNull(); // Initially null

      await waitFor(() => {
        expect(result.current.workspaceInfo).toEqual({
          isCustomWorkspace: true,
          rootPath: '/custom',
        });
      });
    });

    it('includes all expected return properties', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      const returnKeys = Object.keys(result.current);
      const expectedKeys = [
        'entries',
        'loading',
        'error',
        'expandedPaths',
        'selectedPath',
        'loadingPaths',
        'workspaceInfo',
        'toggleDirectory',
        'selectFile',
        'refresh',
        'handleFileChange',
      ];

      expect(returnKeys).toEqual(expect.arrayContaining(expectedKeys));
      expect(returnKeys).toHaveLength(expectedKeys.length);
    });
  });

  describe('cache eviction on invalid paths', () => {
    it('evicts path from expandedPaths on 404 error', async () => {
      const mockLocalStorage = vi.mocked(localStorage);
      mockLocalStorage.getItem.mockReturnValue('["src","invalid-dir"]');

      const mockFetch = vi.mocked(fetch);
      
      // Initial load succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      // Fetch for 'src' succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'index.ts', path: 'src/index.ts', type: 'file', children: null },
          ],
        }),
      } as Response);

      // Fetch for 'invalid-dir' returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: 'Directory not found' }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 'invalid-dir' should be removed from expandedPaths
      await waitFor(() => {
        expect(result.current.expandedPaths.has('invalid-dir')).toBe(false);
        expect(result.current.expandedPaths.has('src')).toBe(true);
      });
    });

    it('evicts path from expandedPaths on 400 Invalid path error', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Toggle a directory that returns 400 Invalid path
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error: 'Invalid path' }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(false);
      });
    });

    it('evicts path from expandedPaths on 400 Not a directory error', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'file.txt', path: 'file.txt', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Toggle what appears to be a directory but is actually a file
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, error: 'Not a directory' }),
      } as Response);

      result.current.toggleDirectory('file.txt');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('file.txt')).toBe(false);
      });
    });

    it('does not evict path on server error statuses (500)', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Toggle directory - returns 500 server error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, error: 'Server error' }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        // Path should still be in expandedPaths (transient error, might work later)
        expect(result.current.expandedPaths.has('src')).toBe(true);
      });
    });

    it('persists cache eviction to localStorage', async () => {
      const mockLocalStorage = vi.mocked(localStorage);
      mockLocalStorage.getItem.mockReturnValue('[]');

      const mockFetch = vi.mocked(fetch);
      
      // Initial load succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const writesBeforeToggle = mockLocalStorage.setItem.mock.calls.length;

      // Toggle directory that returns 404
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: 'Directory not found' }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(false);
      });

      // Verify localStorage.setItem was called to persist the change
      await waitFor(() => {
        expect(mockLocalStorage.setItem.mock.calls.length).toBeGreaterThan(writesBeforeToggle);
        expect(mockLocalStorage.setItem).toHaveBeenLastCalledWith(
          getWorkspaceStorageKey('file-tree-expanded', 'main'),
          expect.not.stringContaining('src'),
        );
      });
    });
  });

  describe('permanent error cache cleanup', () => {
    it('prunes descendant expanded paths when a parent directory returns 404 on restore', async () => {
      const mockLocalStorage = vi.mocked(localStorage);
      mockLocalStorage.getItem.mockReturnValue('["src","src/components","src/components/button"]');

      const mockFetch = vi.mocked(fetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: 'Directory not found' }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'button.tsx', path: 'src/components/button.tsx', type: 'file', children: null },
          ],
        }),
      } as Response);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(false);
        expect(result.current.expandedPaths.has('src/components')).toBe(false);
        expect(result.current.expandedPaths.has('src/components/button')).toBe(false);
      });
    });

    it('clears cached children after a permanent error so a later expand refetches', async () => {
      const mockFetch = vi.mocked(fetch);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'index.ts', path: 'src/index.ts', type: 'file', children: null },
          ],
        }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(true);
        expect(result.current.entries.find((entry) => entry.path === 'src')?.children).toHaveLength(1);
        expect(result.current.entries.find((entry) => entry.path === 'src')?.children?.[0]?.path).toBe('src/index.ts');
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: 'Directory not found' }),
      } as Response);

      result.current.handleFileChange('src/index.ts');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(false);
        expect(result.current.entries.find((entry) => entry.path === 'src')?.children).toBeNull();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'main.ts', path: 'src/main.ts', type: 'file', children: null },
          ],
        }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(true);
        expect(result.current.entries.find((entry) => entry.path === 'src')?.children).toHaveLength(1);
        expect(result.current.entries.find((entry) => entry.path === 'src')?.children?.[0]?.path).toBe('src/main.ts');
      });
    });
  });

  describe('agent-scoped state', () => {
    it('persists selected paths under an agent-scoped key', async () => {
      const mockLocalStorage = vi.mocked(localStorage);
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree('main'));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.selectFile('src/index.ts');
      });

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        getWorkspaceStorageKey('file-tree-selected', 'main'),
        'src/index.ts',
      );
    });

    it('reloads scoped state and tree data when the agent changes', async () => {
      const mockLocalStorage = vi.mocked(localStorage);
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === getWorkspaceStorageKey('file-tree-expanded', 'main')) return JSON.stringify(['src']);
        if (key === getWorkspaceStorageKey('file-tree-selected', 'main')) return 'src/index.ts';
        if (key === getWorkspaceStorageKey('file-tree-expanded', 'research')) return JSON.stringify(['notes']);
        if (key === getWorkspaceStorageKey('file-tree-selected', 'research')) return 'notes/todo.md';
        return null;
      });

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockImplementation(async (input) => {
        const requestUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const url = new URL(requestUrl, 'http://localhost');
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path');

        if (!path && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'src', path: 'src', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace-main' },
            }),
          } as Response;
        }

        if (path === 'src' && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'index.ts', path: 'src/index.ts', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        if (!path && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'notes', path: 'notes', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: true, rootPath: '/workspace-research' },
            }),
          } as Response;
        }

        if (path === 'notes' && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'todo.md', path: 'notes/todo.md', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'Not found' }),
        } as Response;
      });

      const { result, rerender } = renderHook(
        ({ agentId }) => useFileTree(agentId),
        { initialProps: { agentId: 'main' } },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries.map((entry) => entry.path)).toEqual(['src']);
        expect(result.current.expandedPaths.has('src')).toBe(true);
        expect(result.current.selectedPath).toBe('src/index.ts');
      });

      rerender({ agentId: 'research' });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries.map((entry) => entry.path)).toEqual(['notes']);
        expect(result.current.expandedPaths.has('notes')).toBe(true);
        expect(result.current.expandedPaths.has('src')).toBe(false);
        expect(result.current.selectedPath).toBe('notes/todo.md');
        expect(result.current.workspaceInfo).toEqual({
          isCustomWorkspace: true,
          rootPath: '/workspace-research',
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('agentId=main'));
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('agentId=research'));
    });

    it('hides the previous agent tree on the first render after switching workspaces', async () => {
      const { mock } = createLocalStorageMock({
        [getWorkspaceStorageKey('file-tree-expanded', 'main')]: JSON.stringify(['src']),
        [getWorkspaceStorageKey('file-tree-selected', 'main')]: 'src/index.ts',
        [getWorkspaceStorageKey('file-tree-expanded', 'research')]: JSON.stringify(['notes']),
        [getWorkspaceStorageKey('file-tree-selected', 'research')]: 'notes/todo.md',
      });
      vi.stubGlobal('localStorage', mock);

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockImplementation(async (input) => {
        const url = getRequestUrl(input);
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path');

        if (!path && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'src', path: 'src', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace-main' },
            }),
          } as Response;
        }

        if (path === 'src' && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'index.ts', path: 'src/index.ts', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        if (!path && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'notes', path: 'notes', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: true, rootPath: '/workspace-research' },
            }),
          } as Response;
        }

        if (path === 'notes' && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'todo.md', path: 'notes/todo.md', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'Not found' }),
        } as Response;
      });

      const researchSnapshots: FileTreeRenderSnapshot[] = [];
      let currentApi!: ReturnType<typeof useFileTree>;

      const { rerender } = render(createElement(FileTreeRenderObserver, {
        agentId: 'main',
        onRender: (_, api) => {
          currentApi = api;
        },
      }));

      await waitFor(() => {
        expect(currentApi.loading).toBe(false);
        expect(currentApi.entries.map((entry) => entry.path)).toEqual(['src']);
        expect(currentApi.expandedPaths.has('src')).toBe(true);
        expect(currentApi.selectedPath).toBe('src/index.ts');
      });

      rerender(createElement(FileTreeRenderObserver, {
        agentId: 'research',
        onRender: (snapshot) => {
          researchSnapshots.push(snapshot);
        },
      }));

      expect(researchSnapshots[0]).toMatchObject({
        agentId: 'research',
        entryPaths: [],
        expandedPaths: ['notes'],
        selectedPath: 'notes/todo.md',
        loading: true,
        loadingPaths: [],
        workspaceRoot: null,
      });

      await waitFor(() => {
        expect(researchSnapshots.at(-1)).toMatchObject({
          agentId: 'research',
          entryPaths: ['notes'],
          expandedPaths: ['notes'],
          selectedPath: 'notes/todo.md',
          loading: false,
          workspaceRoot: '/workspace-research',
        });
      });
    });

    it('drops late root loads that resolve during the pre-effect switch window', async () => {
      const { mock } = createLocalStorageMock();
      vi.stubGlobal('localStorage', mock);

      const mainRootLoad = createDeferred<Response>();
      const researchSnapshots: FileTreeRenderSnapshot[] = [];
      let currentApi!: ReturnType<typeof useFileTree>;
      let resolveMainRootOnResearchRender = false;
      let resolvedMainRoot = false;

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockImplementation(async (input) => {
        const url = getRequestUrl(input);
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path');

        if (!path && agentId === 'main') {
          return mainRootLoad.promise;
        }

        if (!path && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'notes', path: 'notes', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: true, rootPath: '/workspace-research' },
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'Not found' }),
        } as Response;
      });

      const { rerender } = render(createElement(FileTreeRenderObserver, {
        agentId: 'main',
        onRender: (_, api) => {
          currentApi = api;
        },
      }));

      await waitFor(() => {
        expect(currentApi.loading).toBe(true);
      });

      await act(async () => {
        resolveMainRootOnResearchRender = true;

        rerender(createElement(FileTreeRenderObserver, {
          agentId: 'research',
          onRender: (snapshot, api) => {
            currentApi = api;
            researchSnapshots.push(snapshot);
            if (resolveMainRootOnResearchRender && !resolvedMainRoot) {
              resolvedMainRoot = true;
              mainRootLoad.resolve({
                ok: true,
                json: async () => ({
                  ok: true,
                  entries: [
                    { name: 'src', path: 'src', type: 'directory' as const, children: null },
                  ],
                  workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace-main' },
                }),
              } as Response);
            }
          },
        }));

        await Promise.resolve();
        await Promise.resolve();
      });

      expect(researchSnapshots[0]).toMatchObject({
        agentId: 'research',
        entryPaths: [],
      });
      expect(researchSnapshots.some((snapshot) => snapshot.entryPaths.includes('src'))).toBe(false);

      await waitFor(() => {
        expect(currentApi.loading).toBe(false);
        expect(currentApi.entries.map((entry) => entry.path)).toEqual(['notes']);
        expect(currentApi.workspaceInfo).toEqual({
          isCustomWorkspace: true,
          rootPath: '/workspace-research',
        });
      });
    });

    it('restores the destination agent tree state without overwriting its persisted storage on switch', async () => {
      const { store, mock } = createLocalStorageMock({
        [getWorkspaceStorageKey('file-tree-expanded', 'main')]: JSON.stringify(['src']),
        [getWorkspaceStorageKey('file-tree-selected', 'main')]: 'src/index.ts',
        [getWorkspaceStorageKey('file-tree-expanded', 'research')]: JSON.stringify(['notes']),
        [getWorkspaceStorageKey('file-tree-selected', 'research')]: 'notes/todo.md',
      });
      vi.stubGlobal('localStorage', mock);

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockImplementation(async (input) => {
        const url = getRequestUrl(input);
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path');

        if (!path && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'src', path: 'src', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace-main' },
            }),
          } as Response;
        }

        if (path === 'src' && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'index.ts', path: 'src/index.ts', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        if (!path && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'notes', path: 'notes', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: true, rootPath: '/workspace-research' },
            }),
          } as Response;
        }

        if (path === 'notes' && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'todo.md', path: 'notes/todo.md', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'Not found' }),
        } as Response;
      });

      const { result, rerender } = renderHook(
        ({ agentId }) => useFileTree(agentId),
        { initialProps: { agentId: 'main' } },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.expandedPaths.has('src')).toBe(true);
        expect(result.current.selectedPath).toBe('src/index.ts');
      });

      rerender({ agentId: 'research' });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries.map((entry) => entry.path)).toEqual(['notes']);
        expect(result.current.expandedPaths.has('notes')).toBe(true);
        expect(result.current.selectedPath).toBe('notes/todo.md');
      });

      expect(store.get(getWorkspaceStorageKey('file-tree-expanded', 'research'))).toBe(JSON.stringify(['notes']));
      expect(store.get(getWorkspaceStorageKey('file-tree-selected', 'research'))).toBe('notes/todo.md');
    });

    it('ignores stale refreshes from the previous agent after a workspace switch', async () => {
      const { mock } = createLocalStorageMock({
        [getWorkspaceStorageKey('file-tree-expanded', 'main')]: JSON.stringify(['src']),
        [getWorkspaceStorageKey('file-tree-selected', 'main')]: 'src/index.ts',
        [getWorkspaceStorageKey('file-tree-expanded', 'research')]: JSON.stringify(['notes']),
        [getWorkspaceStorageKey('file-tree-selected', 'research')]: 'notes/todo.md',
      });
      vi.stubGlobal('localStorage', mock);

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockImplementation(async (input) => {
        const url = getRequestUrl(input);
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path');

        if (!path && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'src', path: 'src', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace-main' },
            }),
          } as Response;
        }

        if (path === 'src' && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'index.ts', path: 'src/index.ts', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        if (!path && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'notes', path: 'notes', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: true, rootPath: '/workspace-research' },
            }),
          } as Response;
        }

        if (path === 'notes' && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'todo.md', path: 'notes/todo.md', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'Not found' }),
        } as Response;
      });

      const { result, rerender } = renderHook(
        ({ agentId }) => useFileTree(agentId),
        { initialProps: { agentId: 'main' } },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries.map((entry) => entry.path)).toEqual(['src']);
      });

      const staleRefresh = result.current.refresh;

      rerender({ agentId: 'research' });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.entries.map((entry) => entry.path)).toEqual(['notes']);
        expect(result.current.selectedPath).toBe('notes/todo.md');
      });

      const callsBeforeStaleRefresh = mockFetch.mock.calls.length;

      act(() => {
        staleRefresh('main');
      });

      expect(mockFetch.mock.calls).toHaveLength(callsBeforeStaleRefresh);
      expect(result.current.loading).toBe(false);
      expect(result.current.entries.map((entry) => entry.path)).toEqual(['notes']);
      expect(result.current.selectedPath).toBe('notes/todo.md');
    });

    it('stores late file selections under the originating agent without changing the active tree', async () => {
      const { store, mock } = createLocalStorageMock({
        [getWorkspaceStorageKey('file-tree-expanded', 'main')]: JSON.stringify(['src']),
        [getWorkspaceStorageKey('file-tree-selected', 'main')]: 'src/index.ts',
        [getWorkspaceStorageKey('file-tree-expanded', 'research')]: JSON.stringify(['notes']),
        [getWorkspaceStorageKey('file-tree-selected', 'research')]: 'notes/todo.md',
      });
      vi.stubGlobal('localStorage', mock);

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockImplementation(async (input) => {
        const url = getRequestUrl(input);
        const agentId = url.searchParams.get('agentId') || 'main';
        const path = url.searchParams.get('path');

        if (!path && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'src', path: 'src', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace-main' },
            }),
          } as Response;
        }

        if (path === 'src' && agentId === 'main') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'index.ts', path: 'src/index.ts', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        if (!path && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'notes', path: 'notes', type: 'directory' as const, children: null },
              ],
              workspaceInfo: { isCustomWorkspace: true, rootPath: '/workspace-research' },
            }),
          } as Response;
        }

        if (path === 'notes' && agentId === 'research') {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              entries: [
                { name: 'todo.md', path: 'notes/todo.md', type: 'file' as const, children: null },
              ],
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ ok: false, error: 'Not found' }),
        } as Response;
      });

      const { result, rerender } = renderHook(
        ({ agentId }) => useFileTree(agentId),
        { initialProps: { agentId: 'main' } },
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.selectedPath).toBe('src/index.ts');
      });

      const staleSelectFile = result.current.selectFile;

      rerender({ agentId: 'research' });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.selectedPath).toBe('notes/todo.md');
      });

      act(() => {
        staleSelectFile('src/renamed.ts', 'main');
      });

      expect(result.current.selectedPath).toBe('notes/todo.md');
      expect(store.get(getWorkspaceStorageKey('file-tree-selected', 'main'))).toBe('src/renamed.ts');
      expect(store.get(getWorkspaceStorageKey('file-tree-selected', 'research'))).toBe('notes/todo.md');
    });
  });

  describe('regression: existing behavior unchanged', () => {
    it('still loads children successfully on valid paths', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Toggle directory - succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'index.ts', path: 'src/index.ts', type: 'file', children: null },
          ],
        }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(true);
        expect(result.current.entries.find((entry) => entry.path === 'src')?.children).toHaveLength(1);
      });
    });

    it('still handles network errors without evicting from cache', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Toggle directory - network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      result.current.toggleDirectory('src');

      await waitFor(() => {
        // Path should still be in expandedPaths (might work on retry)
        expect(result.current.expandedPaths.has('src')).toBe(true);
      });
    });

    it('still collapses directories when toggled again', async () => {
      const mockFetch = vi.mocked(fetch);
      
      // Initial load
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'src', path: 'src', type: 'directory', children: null },
          ],
          workspaceInfo: { isCustomWorkspace: false, rootPath: '/workspace' },
        }),
      } as Response);

      const { result } = renderHook(() => useFileTree());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Expand directory
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          entries: [
            { name: 'index.ts', path: 'src/index.ts', type: 'file', children: null },
          ],
        }),
      } as Response);

      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(true);
      });

      // Collapse directory
      result.current.toggleDirectory('src');

      await waitFor(() => {
        expect(result.current.expandedPaths.has('src')).toBe(false);
      });
    });
  });
});
