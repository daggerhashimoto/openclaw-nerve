import { describe, expect, it, vi } from 'vitest';
import { isUnsupportedError, normalizeApproval, normalizeApprovalList, resolveApproval } from './execApprovals';

const NOW = 1_795_865_000_000;

/** The shape `exec.approval.list` answers on OpenClaw 2026.11 (read from its dist). */
const LISTED = {
  id: 'ap_1',
  approvalKind: 'exec',
  createdAtMs: NOW - 60_000,
  expiresAtMs: NOW + 1_740_000,
  request: {
    command: 'rm -rf /srv/app/build',
    commandPreview: 'rm -rf build',
    cwd: '/srv/app',
    host: 'gateway',
    agentId: 'kim',
    sessionKey: 'agent:kim:main',
    warningText: 'Deletes files',
    allowedDecisions: ['allow-once', 'allow-always', 'deny'],
  },
};

describe('normalizeApproval', () => {
  it('reads the full command and its preview, where it runs, who asks and the decisions allowed', () => {
    expect(normalizeApproval(LISTED, NOW)).toEqual({
      id: 'ap_1',
      command: 'rm -rf /srv/app/build',
      preview: 'rm -rf build',
      cwd: '/srv/app',
      host: 'gateway',
      agentId: 'kim',
      sessionKey: 'agent:kim:main',
      warning: 'Deletes files',
      decisions: ['allow-once', 'allow-always', 'deny'],
      createdAt: NOW - 60_000,
      expiresAt: NOW + 1_740_000,
    });
  });

  it('drops a preview that says the same as the command, and reads a node run plan', () => {
    expect(normalizeApproval({ ...LISTED, request: { ...LISTED.request, commandPreview: 'rm -rf /srv/app/build' } }, NOW)?.preview).toBeUndefined();
    const node = normalizeApproval({ id: 'n1', request: { host: 'node', systemRunPlan: { commandText: 'make deploy', commandPreview: 'make' } } }, NOW);
    expect(node).toMatchObject({ command: 'make deploy', preview: 'make' });
  });

  it('offers allow always only when the gateway allows it', () => {
    const once = normalizeApproval({ ...LISTED, request: { ...LISTED.request, allowedDecisions: ['allow-once', 'deny'] } }, NOW);
    expect(once?.decisions).toEqual(['allow-once', 'deny']);
  });

  it('drops entries without an id or a command', () => {
    expect(normalizeApproval({ request: { command: 'ls' } })).toBeNull();
    expect(normalizeApproval({ id: 'x', request: {} })).toBeNull();
  });
});

describe('normalizeApprovalList', () => {
  it('takes a bare array or { approvals }, and only exec approvals', () => {
    expect(normalizeApprovalList([LISTED], NOW)).toHaveLength(1);
    expect(normalizeApprovalList({ approvals: [LISTED] }, NOW)).toHaveLength(1);
    expect(normalizeApprovalList([{ ...LISTED, approvalKind: 'plugin' }], NOW)).toEqual([]);
    expect(normalizeApprovalList({}, NOW)).toEqual([]);
  });
});

describe('resolveApproval', () => {
  it('sends only the id and the decision', async () => {
    const rpc = vi.fn(async () => ({ ok: true }));
    await resolveApproval(rpc, 'ap_1', 'deny');
    expect(rpc).toHaveBeenCalledWith('exec.approval.resolve', { id: 'ap_1', decision: 'deny' });
  });

  it('refuses without a socket', async () => {
    await expect(resolveApproval(undefined, 'ap_1', 'allow-once')).rejects.toThrow('Not connected');
  });
});

describe('isUnsupportedError', () => {
  it('reads an unknown method as a gateway without approvals', () => {
    expect(isUnsupportedError(new Error('unknown method: exec.approval.list'))).toBe(true);
    expect(isUnsupportedError(new Error('Timeout'))).toBe(false);
  });
});
