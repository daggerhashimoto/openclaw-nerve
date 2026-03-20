import { describe, expect, it } from 'vitest';
import { shouldGuardWorkspaceSwitch } from './workspaceSwitchGuard';

describe('shouldGuardWorkspaceSwitch', () => {
  it('does not guard when switching into a subagent under the same top-level agent', () => {
    expect(shouldGuardWorkspaceSwitch('agent:main:main', 'agent:main:subagent:abc', true)).toBe(false);
  });

  it('guards when dirty files exist and the owning top-level agent changes', () => {
    expect(shouldGuardWorkspaceSwitch('agent:main:subagent:abc', 'agent:research:main', true)).toBe(true);
  });

  it('does not guard same-agent switches when moving back into a subagent', () => {
    expect(shouldGuardWorkspaceSwitch('agent:research:main', 'agent:research:subagent:xyz', true)).toBe(false);
  });

  it('does not guard cross-agent switches when there are no dirty files', () => {
    expect(shouldGuardWorkspaceSwitch('agent:main:main', 'agent:research:main', false)).toBe(false);
  });
});
