import { describe, expect, it } from 'vitest';
import { getSessionDeleteRefusal, isUndeletableSessionKey } from './sessionDeletion';

describe('isUndeletableSessionKey', () => {
  it('flags agent main sessions and the global session', () => {
    expect(isUndeletableSessionKey('agent:main:main')).toBe(true);
    expect(isUndeletableSessionKey('agent:ops:main')).toBe(true);
    expect(isUndeletableSessionKey('global')).toBe(true);
  });

  it('allows child sessions of an agent', () => {
    expect(isUndeletableSessionKey('agent:ops:subagent:worker')).toBe(false);
    expect(isUndeletableSessionKey('agent:ops:cron:nightly')).toBe(false);
    expect(isUndeletableSessionKey('agent:ops:cron:nightly:run:r1')).toBe(false);
    expect(isUndeletableSessionKey('agent:main:telegram:direct:123')).toBe(false);
    expect(isUndeletableSessionKey('agent:ops:main:thread:1')).toBe(false);
  });
});

describe('getSessionDeleteRefusal', () => {
  it('returns null when every key can be deleted', () => {
    expect(getSessionDeleteRefusal([])).toBeNull();
    expect(getSessionDeleteRefusal(['agent:ops:subagent:worker', 'agent:ops:cron:nightly'])).toBeNull();
  });

  it('names the first undeletable key and says nothing was deleted', () => {
    const refusal = getSessionDeleteRefusal(['agent:ops:subagent:worker', 'agent:ops:main', 'global']);
    expect(refusal).toContain('Nothing was deleted');
    expect(refusal).toContain('agent:ops:main');
    expect(refusal).not.toContain('global');
  });
});
