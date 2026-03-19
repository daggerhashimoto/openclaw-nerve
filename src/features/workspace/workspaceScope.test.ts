import { describe, expect, it } from 'vitest';
import {
  getWorkspaceAgentId,
  getWorkspaceRootSessionKey,
  getWorkspaceStorageKey,
} from './workspaceScope';

describe('workspaceScope', () => {
  it('uses the top-level agent for a root session', () => {
    expect(getWorkspaceAgentId('agent:test:main')).toBe('test');
    expect(getWorkspaceRootSessionKey('agent:test:main')).toBe('agent:test:main');
  });

  it('uses the owning top-level agent for a subagent session', () => {
    expect(getWorkspaceAgentId('agent:test:subagent:abc')).toBe('test');
    expect(getWorkspaceRootSessionKey('agent:test:subagent:abc')).toBe('agent:test:main');
  });

  it('uses the owning top-level agent for a cron run session', () => {
    expect(getWorkspaceAgentId('agent:test:cron:daily:run:xyz')).toBe('test');
    expect(getWorkspaceRootSessionKey('agent:test:cron:daily:run:xyz')).toBe('agent:test:main');
  });

  it('falls back to main for unknown session keys', () => {
    expect(getWorkspaceAgentId('weird-session-key')).toBe('main');
    expect(getWorkspaceRootSessionKey('weird-session-key')).toBe('agent:main:main');
  });

  it('namespaces storage keys per agent', () => {
    expect(getWorkspaceStorageKey('open-files', 'test')).toBe('nerve:workspace:test:open-files');
  });
});
