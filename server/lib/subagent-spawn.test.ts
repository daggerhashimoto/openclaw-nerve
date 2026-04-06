/** Tests for the server-side subagent spawn helper. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as gatewayRpc from './gateway-rpc.js';
import {
  __resetSubagentSpawnTestState,
  buildSpawnSubagentMarkerMessage,
  buildSubagentParentCompletionMessage,
  extractAssistantResultForLaunch,
  isTopLevelRootSessionKey,
  isUnsupportedDirectSpawnError,
  pickMarkerSpawnedChildSession,
  spawnSubagent,
} from './subagent-spawn.js';

describe('subagent-spawn helper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSubagentSpawnTestState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __resetSubagentSpawnTestState();
  });

  it('recognizes top-level root session keys only', () => {
    expect(isTopLevelRootSessionKey('agent:reviewer:main')).toBe(true);
    expect(isTopLevelRootSessionKey('agent:reviewer:subagent:abc')).toBe(false);
    expect(isTopLevelRootSessionKey('agent:reviewer:cron:daily')).toBe(false);
  });

  it('matches only narrow unsupported direct spawn errors', () => {
    expect(isUnsupportedDirectSpawnError(new Error('unknown method: sessions.create'))).toBe(true);
    expect(isUnsupportedDirectSpawnError(new Error('unknown method: sessions.send'))).toBe(true);
    expect(isUnsupportedDirectSpawnError(new Error('unknown method: chat.send'))).toBe(false);
    expect(isUnsupportedDirectSpawnError(new Error('internal server error'))).toBe(false);
  });

  it('builds the existing spawn-subagent marker message', () => {
    expect(buildSpawnSubagentMarkerMessage({
      task: 'Reply with exactly: OK',
      label: 'audit-auth-flow',
      model: 'openai/gpt-5',
      thinking: 'high',
      cleanup: 'delete',
    })).toBe([
      '[spawn-subagent]',
      'task: Reply with exactly: OK',
      'label: audit-auth-flow',
      'model: openai/gpt-5',
      'thinking: high',
      'mode: run',
      'cleanup: delete',
    ].join('\n'));
  });

  it('builds the generic parent completion report', () => {
    const completed = buildSubagentParentCompletionMessage({
      parentSessionKey: 'agent:reviewer:main',
      childSessionKey: 'agent:reviewer:subagent:abc',
      label: 'audit-auth-flow',
      outcome: 'completed',
      result: 'done',
    });
    expect(completed).toContain('Subagent child session completion report.');
    expect(completed).toContain('Parent root: agent:reviewer:main');
    expect(completed).toContain('Child session: agent:reviewer:subagent:abc');
    expect(completed).toContain('Outcome: completed');
    expect(completed).toContain('Result:');

    const failed = buildSubagentParentCompletionMessage({
      parentSessionKey: 'agent:reviewer:main',
      childSessionKey: 'agent:reviewer:subagent:abc',
      outcome: 'failed',
      error: 'boom',
    });
    expect(failed).toContain('Outcome: failed');
    expect(failed).toContain('Error:');
  });

  it('picks only a new child absent from the pre-send snapshot', () => {
    const picked = pickMarkerSpawnedChildSession([
      { sessionKey: 'agent:reviewer:main' },
      { sessionKey: 'agent:reviewer:subagent:existing' },
      { sessionKey: 'agent:reviewer:subagent:new-child' },
    ], 'agent:reviewer:main', new Set(['agent:reviewer:main', 'agent:reviewer:subagent:existing']));

    expect(picked?.sessionKey).toBe('agent:reviewer:subagent:new-child');
  });

  it('extracts a launched run by runId first, before later manual follow-ups', () => {
    const extracted = extractAssistantResultForLaunch([
      { role: 'user', content: 'launch task', runId: 'run-1', timestamp: 100 },
      { role: 'assistant', content: 'launch result', runId: 'run-1', timestamp: 101 },
      { role: 'user', content: 'manual follow-up', timestamp: 102 },
      { role: 'assistant', content: 'manual answer', timestamp: 103 },
    ], { runId: 'run-1', launchTimestamp: 99 });

    expect(extracted).toEqual({ started: true, resultText: 'launch result' });
  });

  it('extracts a launched run by launch boundary when runId is unavailable', () => {
    const extracted = extractAssistantResultForLaunch([
      { role: 'user', content: 'older context', timestamp: 10 },
      { role: 'assistant', content: 'older answer', timestamp: 11 },
      { role: 'user', content: 'launch task', timestamp: 100 },
      { role: 'assistant', content: 'launch result', timestamp: 101 },
      { role: 'user', content: 'manual follow-up', timestamp: 102 },
      { role: 'assistant', content: 'manual answer', timestamp: 103 },
    ], { launchTimestamp: 100 });

    expect(extracted).toEqual({ started: true, resultText: 'launch result' });
  });

  it('resolves the canonical child key returned by sessions.create', async () => {
    const rpcMock = vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method) => {
      if (method === 'sessions.create') return { key: 'agent:reviewer:subagent:canonical' };
      if (method === 'sessions.send') return { runId: 'run-123' };
      if (method === 'sessions.list') return { sessions: [] };
      return {};
    });

    const result = await spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Reply with exactly: OK',
    });

    expect(result).toEqual({
      sessionKey: 'agent:reviewer:subagent:canonical',
      runId: 'run-123',
      mode: 'direct',
    });
    expect(rpcMock).toHaveBeenNthCalledWith(1, 'sessions.create', expect.any(Object));
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'sessions.send', expect.objectContaining({
      key: 'agent:reviewer:subagent:canonical',
      message: 'Reply with exactly: OK',
    }));
  });

  it('does not delete the child when sessions.send fails after create', async () => {
    const rpcMock = vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      if (method === 'sessions.create') return { key: 'agent:reviewer:subagent:canonical' };
      if (method === 'sessions.send' && params.key === 'agent:reviewer:subagent:canonical') {
        throw new Error('send failed');
      }
      if (method === 'sessions.delete') return { ok: true };
      throw new Error(`unexpected call: ${method}`);
    });

    await expect(spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Reply with exactly: OK',
    })).rejects.toThrow('send failed');

    expect(rpcMock).not.toHaveBeenCalledWith('sessions.delete', expect.anything());
  });

  it('reports completion back to the parent on direct success', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let listPolls = 0;

    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      calls.push({ method, params });

      if (method === 'sessions.create') return { key: 'agent:reviewer:subagent:child-1' };
      if (method === 'sessions.send' && params.key === 'agent:reviewer:subagent:child-1') return { runId: 'run-1' };
      if (method === 'sessions.list') {
        listPolls += 1;
        if (listPolls === 1) {
          return {
            sessions: [{
              sessionKey: 'agent:reviewer:subagent:child-1',
              status: 'running',
              busy: true,
              runId: 'run-1',
            }],
          };
        }
        return {
          sessions: [{
            sessionKey: 'agent:reviewer:subagent:child-1',
            status: 'done',
            agentState: 'idle',
            busy: false,
            processing: false,
            runId: 'run-1',
          }],
        };
      }
      if (method === 'sessions.get') {
        return {
          messages: [
            { role: 'user', content: 'Reply with exactly: OK', runId: 'run-1', timestamp: 100 },
            { role: 'assistant', content: 'OK', runId: 'run-1', timestamp: 101 },
            { role: 'user', content: 'manual follow-up', timestamp: 102 },
            { role: 'assistant', content: 'later answer', timestamp: 103 },
          ],
        };
      }
      if (method === 'sessions.send' && params.key === 'agent:reviewer:main') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });

    await spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Reply with exactly: OK',
      label: 'audit-auth-flow',
      cleanup: 'keep',
    });

    await vi.advanceTimersByTimeAsync(20_000);

    const parentReport = calls.find((call) => call.method === 'sessions.send' && call.params.key === 'agent:reviewer:main');
    expect(parentReport).toBeTruthy();
    expect(String(parentReport?.params.message ?? '')).toContain('Outcome: completed');
    expect(String(parentReport?.params.message ?? '')).toContain('Label: audit-auth-flow');
    expect(String(parentReport?.params.message ?? '')).toContain('Result:\nOK');
  });

  it('reports failure back to the parent when the child errors', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      calls.push({ method, params });
      if (method === 'sessions.create') return { key: 'agent:reviewer:subagent:child-2' };
      if (method === 'sessions.send' && params.key === 'agent:reviewer:subagent:child-2') return { runId: 'run-2' };
      if (method === 'sessions.list') {
        return {
          sessions: [{
            sessionKey: 'agent:reviewer:subagent:child-2',
            status: 'failed',
            error: 'worker crashed',
          }],
        };
      }
      if (method === 'sessions.send' && params.key === 'agent:reviewer:main') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });

    await spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Do something',
      cleanup: 'keep',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    const parentReport = calls.find((call) => call.method === 'sessions.send' && call.params.key === 'agent:reviewer:main');
    expect(parentReport).toBeTruthy();
    expect(String(parentReport?.params.message ?? '')).toContain('Outcome: failed');
    expect(String(parentReport?.params.message ?? '')).toContain('worker crashed');
  });

  it('deletes the child only after the parent report when cleanup=delete', async () => {
    const callOrder: string[] = [];

    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      callOrder.push(`${method}:${String((params as Record<string, unknown>).key ?? '')}`);
      if (method === 'sessions.create') return { key: 'agent:reviewer:subagent:child-3' };
      if (method === 'sessions.send' && params.key === 'agent:reviewer:subagent:child-3') return { runId: 'run-3' };
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:subagent:child-3', status: 'failed', error: 'boom' }] };
      }
      if (method === 'sessions.send' && params.key === 'agent:reviewer:main') return { ok: true };
      if (method === 'sessions.delete') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });

    await spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Do something',
      cleanup: 'delete',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    const reportIndex = callOrder.findIndex((entry) => entry === 'sessions.send:agent:reviewer:main');
    const deleteIndex = callOrder.findIndex((entry) => entry === 'sessions.delete:agent:reviewer:subagent:child-3');
    expect(reportIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(reportIndex);
  });

  it('keeps the child when cleanup=keep', async () => {
    const rpcMock = vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      if (method === 'sessions.create') return { key: 'agent:reviewer:subagent:child-4' };
      if (method === 'sessions.send' && params.key === 'agent:reviewer:subagent:child-4') return { runId: 'run-4' };
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:reviewer:subagent:child-4', status: 'failed', error: 'boom' }] };
      }
      if (method === 'sessions.send' && params.key === 'agent:reviewer:main') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });

    await spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Do something',
      cleanup: 'keep',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(rpcMock).not.toHaveBeenCalledWith('sessions.delete', expect.anything());
  });

  it('falls back to marker mode only for narrow unsupported direct-RPC errors', async () => {
    let listCallCount = 0;
    const rpcMock = vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method) => {
      if (method === 'sessions.create') throw new Error('unknown method: sessions.create');
      if (method === 'sessions.list') {
        listCallCount += 1;
        if (listCallCount === 1) {
          return { sessions: [{ sessionKey: 'agent:reviewer:main' }, { sessionKey: 'agent:reviewer:subagent:existing' }] };
        }
        return { sessions: [{ sessionKey: 'agent:reviewer:main' }, { sessionKey: 'agent:reviewer:subagent:existing' }, { sessionKey: 'agent:reviewer:subagent:new-child' }] };
      }
      if (method === 'chat.send') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });

    const resultPromise = spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Do something',
      cleanup: 'delete',
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).resolves.toEqual({
      sessionKey: 'agent:reviewer:subagent:new-child',
      mode: 'marker',
    });
    expect(rpcMock).toHaveBeenCalledWith('chat.send', expect.objectContaining({
      sessionKey: 'agent:reviewer:main',
      message: expect.stringContaining('[spawn-subagent]'),
    }));
  });

  it('falls back to the first new child instead of timing out when multiple candidates appear', async () => {
    let listCallCount = 0;

    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method) => {
      if (method === 'sessions.create') throw new Error('unknown method: sessions.create');
      if (method === 'sessions.list') {
        listCallCount += 1;
        if (listCallCount === 1) {
          return { sessions: [{ sessionKey: 'agent:reviewer:main' }] };
        }
        return {
          sessions: [
            { sessionKey: 'agent:reviewer:main' },
            { sessionKey: 'agent:reviewer:subagent:new-child-a' },
            { sessionKey: 'agent:reviewer:subagent:new-child-b' },
          ],
        };
      }
      if (method === 'chat.send') return { ok: true };
      throw new Error(`unexpected ${method}`);
    });

    const resultPromise = spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Do something',
      cleanup: 'keep',
    });

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(resultPromise).resolves.toEqual({
      sessionKey: 'agent:reviewer:subagent:new-child-a',
      mode: 'marker',
    });
  });

  it('does not hide generic direct-launch errors behind marker fallback', async () => {
    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method) => {
      if (method === 'sessions.create') throw new Error('parent root not found');
      throw new Error(`unexpected ${method}`);
    });

    await expect(spawnSubagent({
      parentSessionKey: 'agent:reviewer:main',
      task: 'Do something',
    })).rejects.toThrow('parent root not found');
  });
});
