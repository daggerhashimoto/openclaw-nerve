import { describe, expect, it } from 'vitest';
import { readAgentIdentityNames } from './SessionContext';

describe('readAgentIdentityNames', () => {
  it('reads real gateway identity names and ignores placeholders', () => {
    const names = readAgentIdentityNames({
      agents: [
        { id: 'main', identity: { name: 'Kim' } },
        { id: 'linus', identity: { name: 'Linus' } },
        { id: 'designer', identity: { name: '_(pick something you like)_' } },
        { id: 'blank', identity: { name: '   ' } },
        { id: 'nameless' },
        { id: '', identity: { name: 'Nobody' } },
      ],
    });

    expect(names).toEqual({ main: 'Kim', linus: 'Linus' });
  });

  it('returns an empty map for a malformed answer', () => {
    expect(readAgentIdentityNames(null)).toEqual({});
    expect(readAgentIdentityNames({ agents: 'nope' })).toEqual({});
    expect(readAgentIdentityNames({ agents: [{ id: 'linus' }] })).toEqual({});
  });
});
