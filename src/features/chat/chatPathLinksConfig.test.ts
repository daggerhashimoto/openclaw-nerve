import { describe, expect, it } from 'vitest';
import {
  createChatPathLinksTemplate,
  createDefaultChatPathLinksConfig,
  parseChatPathLinksConfig,
  stringifyChatPathLinksConfig,
} from './chatPathLinksConfig';

describe('chatPathLinksConfig', () => {
  it('builds richer local defaults from workspace and user context', () => {
    const config = createDefaultChatPathLinksConfig({
      platform: 'linux',
      username: 'derrick',
      workspaceRoot: '/home/derrick/.openclaw/workspace',
    });

    expect(config.prefixes).toEqual([
      '/workspace/',
      '/home/derrick/.openclaw/workspace/',
      '/home/derrick/workspace/',
    ]);
  });

  it('derives Windows-aware defaults from the actual workspace root', () => {
    const config = createDefaultChatPathLinksConfig({
      platform: 'win32',
      username: 'derrick',
      workspaceRoot: 'D:\\Users\\derrick\\.openclaw\\workspace-research',
    });

    expect(config.prefixes).toEqual([
      '/workspace/',
      'D:/Users/derrick/.openclaw/workspace-research/',
      'D:/Users/derrick/.openclaw/workspace/',
      'D:/Users/derrick/workspace/',
    ]);
  });

  it('falls back to conventional Windows home defaults when only username is available', () => {
    const config = createDefaultChatPathLinksConfig({
      platform: 'windows',
      username: 'derrick',
    });

    expect(config.prefixes).toEqual([
      '/workspace/',
      'C:/Users/derrick/.openclaw/workspace/',
      'C:/Users/derrick/workspace/',
    ]);
  });

  it('normalizes, dedupes, and falls back when parsing', () => {
    expect(parseChatPathLinksConfig('{"prefixes":[" /workspace ","/workspace/","","  "]}')).toEqual({
      prefixes: ['/workspace/'],
      aliases: {},
    });

    expect(parseChatPathLinksConfig('{"prefixes":[]}')).toEqual({
      prefixes: ['/workspace/'],
      aliases: {},
    });
  });

  it('serializes the shared template with trailing newline', () => {
    const template = createChatPathLinksTemplate({
      platform: 'linux',
      homeDir: '/home/derrick',
      workspaceRoot: '/home/derrick/.openclaw/workspace',
    });

    expect(template).toBe(
      '{\n'
      + '  "prefixes": [\n'
      + '    "/workspace/",\n'
      + '    "/home/derrick/.openclaw/workspace/",\n'
      + '    "/home/derrick/workspace/"\n'
      + '  ],\n'
      + '  "aliases": {}\n'
      + '}\n',
    );

    expect(stringifyChatPathLinksConfig({ prefixes: ['/workspace', '/workspace/'], aliases: {} })).toBe(
      '{\n'
      + '  "prefixes": [\n'
      + '    "/workspace/"\n'
      + '  ],\n'
      + '  "aliases": {}\n'
      + '}\n',
    );
  });
});
