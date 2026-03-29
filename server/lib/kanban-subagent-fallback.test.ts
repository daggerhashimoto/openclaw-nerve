/**
 * Tests for Kanban subagent launch helper.
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildKanbanFallbackRunKey,
  launchKanbanFallbackSubagentViaRpc,
  resolveKanbanFallbackParentSessionKey,
} from './kanban-subagent-fallback.js';
import * as gatewayRpc from './gateway-rpc.js';

describe('launchKanbanFallbackSubagentViaRpc', () => {
  let calls: Array<{ method: string; params: Record<string, unknown> }>;

  beforeEach(() => {
    calls = [];
    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      calls.push({ method, params });

      if (method === 'sessions.list') {
        return {
          sessions: [
            { sessionKey: 'agent:main:main' },
            { sessionKey: 'agent:reviewer:main' },
            { sessionKey: 'agent:reviewer:subagent:existing-child' },
          ],
        };
      }
      if (method === 'chat.send') {
        return { ok: true, runId: 'mock-run-id-12345' };
      }
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls sessions.list before chat.send', async () => {
    await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    });

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].method).toBe('sessions.list');
    expect(calls[1].method).toBe('chat.send');
  });

  it('uses a 1-week lookup window and full session inventory when validating parent root existence', async () => {
    await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    });

    expect(calls[0].params.activeMinutes).toBe(7 * 24 * 60);
    expect(calls[0].params.limit).toBe(1000);
  });

  it('aborts before chat.send when parent root session is missing', async () => {
    vi.spyOn(gatewayRpc, 'gatewayRpcCall').mockImplementation(async (method, params) => {
      calls.push({ method, params });
      if (method === 'sessions.list') {
        return { sessions: [{ sessionKey: 'agent:main:main' }] };
      }
      if (method === 'chat.send') {
        return { ok: true, runId: 'should-not-happen' };
      }
      return {};
    });

    await expect(launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    })).rejects.toThrow('Parent agent session not found');

    expect(calls.some((call) => call.method === 'sessions.list')).toBe(true);
    expect(calls.some((call) => call.method === 'chat.send')).toBe(false);
  });

  it('sends the spawn request to the parent root session', async () => {
    await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    });

    const chatSendCall = calls.find(c => c.method === 'chat.send');
    expect(chatSendCall?.params.sessionKey).toBe('agent:reviewer:main');
    expect(chatSendCall?.params.deliver).toBeUndefined();
  });

  it('encodes a spawn-subagent message with label, model, and thinking', async () => {
    await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
      model: 'openai-codex/gpt-5.4',
      thinking: 'high',
    });

    const chatSendCall = calls.find(c => c.method === 'chat.send');
    expect(chatSendCall?.params.message).toBe(
      [
        '[spawn-subagent]',
        'task: Execute kanban task',
        'label: test-kanban-run',
        'model: openai-codex/gpt-5.4',
        'thinking: high',
        'mode: run',
        'cleanup: keep',
      ].join('\n'),
    );
  });

  it('returns the deterministic run correlation key and runId', async () => {
    const result = await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    });

    expect(result.sessionKey).toBe('kanban-root:test-kanban-run');
    expect(result.runId).toBe('mock-run-id-12345');
  });

  it('returns the known session keys snapshot captured before spawn', async () => {
    const result = await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    });

    expect(result.knownSessionKeysBefore).toEqual([
      'agent:main:main',
      'agent:reviewer:main',
      'agent:reviewer:subagent:existing-child',
    ]);
  });

  it('generates an idempotency key for chat.send', async () => {
    await launchKanbanFallbackSubagentViaRpc({
      label: 'test-kanban-run',
      task: 'Execute kanban task',
      parentSessionKey: 'agent:reviewer:main',
    });

    const chatSendCall = calls.find(c => c.method === 'chat.send');
    expect(chatSendCall?.params.idempotencyKey).toBeDefined();
    expect(typeof chatSendCall?.params.idempotencyKey).toBe('string');
    expect((chatSendCall?.params.idempotencyKey as string).length).toBeGreaterThan(0);
  });
});

describe('buildKanbanFallbackRunKey', () => {
  it('returns a deterministic run correlation key derived from label', () => {
    expect(buildKanbanFallbackRunKey('test-kanban-run')).toBe('kanban-root:test-kanban-run');
  });
});

describe('resolveKanbanFallbackParentSessionKey', () => {
  it('maps an assignee agent id to its top-level root session', () => {
    expect(resolveKanbanFallbackParentSessionKey('agent:reviewer')).toBe('agent:reviewer:main');
  });

  it('normalizes full agent-flavored values back to the owning top-level root', () => {
    expect(resolveKanbanFallbackParentSessionKey('agent:reviewer:main')).toBe('agent:reviewer:main');
    expect(resolveKanbanFallbackParentSessionKey('agent:reviewer:subagent:child')).toBe('agent:reviewer:main');
  });

  it('rejects operator, unset, and @main assignees for macOS fallback execution', () => {
    expect(resolveKanbanFallbackParentSessionKey('operator')).toBeNull();
    expect(resolveKanbanFallbackParentSessionKey(undefined)).toBeNull();
    expect(resolveKanbanFallbackParentSessionKey('agent:main')).toBeNull();
  });
});
