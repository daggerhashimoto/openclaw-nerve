import { describe, expect, it } from 'vitest';
import {
  extractIdentityName,
  getSessionDisplayLabel,
  isPlaceholderIdentityName,
} from './sessionKeys';

const STARTER_IDENTITY = `# IDENTITY.md - Who Am I?

_Fill this in during your first conversation. Make it yours._

- **Name:**
  _(pick something you like)_
- **Creature:**
  _(AI? robot? familiar? ghost in the machine? something weirder?)_
- **Vibe:**
  _(how do you come across? sharp? warm? chaotic? calm?)_
- **Emoji:**
  _(your signature — pick one that feels right)_
- **Avatar:**
  _(workspace-relative path, http(s) URL, or data URI)_
`;

describe('extractIdentityName', () => {
  it('reads a real name from the Name line', () => {
    expect(extractIdentityName('# IDENTITY.md\n\n- **Name:** Linus\n')).toBe('Linus');
  });

  it('does not cross the newline into the starter placeholder', () => {
    expect(extractIdentityName(STARTER_IDENTITY)).toBeNull();
  });

  it('rejects a placeholder on the same line', () => {
    expect(extractIdentityName('- **Name:** _(pick something you like)_')).toBeNull();
  });

  it('trims markdown emphasis and trailing punctuation', () => {
    expect(extractIdentityName('- **Name:** **Linus!**')).toBe('Linus');
  });

  it('returns null when there is no Name field', () => {
    expect(extractIdentityName('- **Vibe:** calm')).toBeNull();
  });

  it('treats "not set yet" as a placeholder', () => {
    expect(extractIdentityName('- **Name:** not set yet')).toBeNull();
  });

  it('skips an empty Name and keeps scanning for a real one', () => {
    expect(extractIdentityName('- **Name:**\n- **Name:** Linus')).toBe('Linus');
  });
});

describe('isPlaceholderIdentityName', () => {
  it.each([
    '',
    '   ',
    '(pick something you like)',
    '_(pick something you like)_',
    'Agent',
    'name',
    'your name',
  ])('rejects %j', (value) => {
    expect(isPlaceholderIdentityName(value)).toBe(true);
  });

  it('accepts a real name', () => {
    expect(isPlaceholderIdentityName('Linus')).toBe(false);
  });
});

describe('getSessionDisplayLabel', () => {
  it('never uses placeholder text as an identity label', () => {
    const session = {
      key: 'agent:linus:main',
      identityName: '_(pick something you like)_',
    };

    expect(getSessionDisplayLabel(session, 'Kim')).toBe('linus');
  });

  it('uses a real identity name when present', () => {
    const session = { key: 'agent:linus:main', identityName: 'Linus' };

    expect(getSessionDisplayLabel(session, 'Kim')).toBe('Linus (linus)');
  });

  it('does not let an explicit placeholder label override the identity', () => {
    const session = {
      key: 'agent:linus:main',
      label: '_(pick something you like)_',
      displayName: 'not set yet',
      identityName: 'Linus',
    };

    expect(getSessionDisplayLabel(session, 'Kim')).toBe('Linus (linus)');
  });
});
