import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('agent-workspace', () => {
  let homeDir: string;
  let memoryPath: string;

  beforeEach(async () => {
    vi.resetModules();
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workspace-test-'));
    memoryPath = path.join(homeDir, '.openclaw', 'workspace', 'MEMORY.md');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function loadModule() {
    vi.doMock('./config.js', () => ({
      config: {
        home: homeDir,
        memoryPath,
      },
    }));

    return import('./agent-workspace.js');
  }

  it('resolves main to the default workspace root', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    expect(resolveAgentWorkspace()).toEqual({
      agentId: 'main',
      workspaceRoot: path.dirname(memoryPath),
      memoryPath,
      memoryDir: path.join(path.dirname(memoryPath), 'memory'),
    });

    expect(resolveAgentWorkspace('   ')).toEqual({
      agentId: 'main',
      workspaceRoot: path.dirname(memoryPath),
      memoryPath,
      memoryDir: path.join(path.dirname(memoryPath), 'memory'),
    });
  });

  it('falls back to a per-agent workspace for non-main agents', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    expect(resolveAgentWorkspace('research')).toEqual({
      agentId: 'research',
      workspaceRoot: path.join(homeDir, '.openclaw', 'workspace-research'),
      memoryPath: path.join(homeDir, '.openclaw', 'workspace-research', 'MEMORY.md'),
      memoryDir: path.join(homeDir, '.openclaw', 'workspace-research', 'memory'),
    });
  });

  it('returns workspaceRoot, memoryPath, and memoryDir together', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    const workspace = resolveAgentWorkspace('research');

    expect(workspace.workspaceRoot).toBe(path.join(homeDir, '.openclaw', 'workspace-research'));
    expect(workspace.memoryPath).toBe(path.join(workspace.workspaceRoot, 'MEMORY.md'));
    expect(workspace.memoryDir).toBe(path.join(workspace.workspaceRoot, 'memory'));
  });

  it('rejects invalid agent ids', async () => {
    const { resolveAgentWorkspace } = await loadModule();

    expect(() => resolveAgentWorkspace('../oops')).toThrow(/agent id/i);
    expect(() => resolveAgentWorkspace('bad/name')).toThrow(/agent id/i);
    expect(() => resolveAgentWorkspace('two words')).toThrow(/agent id/i);
    expect(() => resolveAgentWorkspace('bad_agent')).toThrow(/agent id/i);
  });
});
