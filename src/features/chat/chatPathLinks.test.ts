import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHAT_PATH_LINKS_CONFIG,
  normalizeChatPathLinkAliases,
  parseChatPathLinksConfig,
  stringifyChatPathLinksConfig,
} from './chatPathLinks';

describe('chatPathLinks config', () => {
  it('defaults to the canonical workspace prefix with no aliases', () => {
    expect(DEFAULT_CHAT_PATH_LINKS_CONFIG).toEqual({ prefixes: ['/workspace/'], aliases: {} });
  });

  it('keeps configured prefixes trimmed while normalizing aliases to canonical workspace targets', () => {
    expect(
      parseChatPathLinksConfig(JSON.stringify({
        prefixes: ['  /workspace/  ', '  /home/derrick/.openclaw/workspace  '],
        aliases: {
          ' projects ': ' workspace/projects ',
          'notes\\': 'file:///workspace/docs/notes',
        },
      })),
    ).toEqual({
      prefixes: ['/workspace/', '/home/derrick/.openclaw/workspace/'],
      aliases: {
        'projects/': '/workspace/projects/',
        'notes/': '/workspace/docs/notes/',
      },
    });
  });

  it('falls back for missing prefixes and ignores invalid aliases', () => {
    expect(parseChatPathLinksConfig('{}')).toEqual({ prefixes: ['/workspace/'], aliases: {} });
    expect(parseChatPathLinksConfig(JSON.stringify({ prefixes: ['   '], aliases: [] }))).toEqual({
      prefixes: ['/workspace/'],
      aliases: {},
    });

    expect(normalizeChatPathLinkAliases({
      '': '/workspace/projects/',
      '/workspace/projects/': '/workspace/projects/',
      'file://projects/': '/workspace/projects/',
      'mailto:projects/': '/workspace/projects/',
      'projects/': '/home/derrick/.openclaw/workspace/projects/',
      'docs/': 'https://example.com/docs/',
      'notes/': '',
      'valid\\': 'workspace/docs/valid',
      'projects\\': '/workspace/projects-override',
    })).toEqual({
      'valid/': '/workspace/docs/valid/',
      'projects/': '/workspace/projects-override/',
    });
  });

  it('rejects aliases that would shadow the built-in workspace shorthand', () => {
    expect(normalizeChatPathLinkAliases({
      'workspace/': '/workspace/override/',
      'workspace/projects/': '/workspace/custom-projects/',
      'docs/': '/workspace/docs/',
    })).toEqual({
      'docs/': '/workspace/docs/',
    });
  });

  it('serializes aliases with a trailing newline', () => {
    expect(stringifyChatPathLinksConfig({
      prefixes: ['/workspace', '/workspace/'],
      aliases: {
        'projects': 'workspace/projects',
      },
    })).toBe(
      '{\n'
      + '  "prefixes": [\n'
      + '    "/workspace/"\n'
      + '  ],\n'
      + '  "aliases": {\n'
      + '    "projects/": "/workspace/projects/"\n'
      + '  }\n'
      + '}\n',
    );
  });
});
