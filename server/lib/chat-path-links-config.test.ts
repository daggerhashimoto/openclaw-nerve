import { describe, expect, it } from 'vitest';

import {
  normalizeChatPathLinkAliases,
  parseChatPathLinksConfig,
} from './chat-path-links-config.js';

describe('chat-path-links-config', () => {
  it('rejects aliases that would shadow the built-in workspace shorthand', () => {
    expect(normalizeChatPathLinkAliases({
      'workspace/': '/workspace/override/',
      'workspace/projects/': '/workspace/custom-projects/',
      'docs/': '/workspace/docs/',
    })).toEqual({
      'docs/': '/workspace/docs/',
    });
  });

  it('parsing drops reserved workspace alias keys while keeping valid aliases', () => {
    expect(parseChatPathLinksConfig(JSON.stringify({
      prefixes: ['/workspace/'],
      aliases: {
        'workspace/': '/workspace/override/',
        'workspace/projects/': '/workspace/custom-projects/',
        'docs/': 'workspace/docs',
      },
    }))).toEqual({
      prefixes: ['/workspace/'],
      aliases: {
        'docs/': '/workspace/docs/',
      },
    });
  });
});
