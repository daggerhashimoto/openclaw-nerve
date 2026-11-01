/** Tests for edit-blocks: parsing edit and write tool blocks. */
import { describe, it, expect } from 'vitest';
import { extractEditBlocks, extractWriteBlocks } from './edit-blocks';

describe('extractEditBlocks', () => {
  it('extracts a single edit block', () => {
    const text = '**tool:** `Edit`\n```json\n{"file_path": "/src/app.ts", "old_string": "foo", "new_string": "bar"}\n```';
    const blocks = extractEditBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].filePath).toBe('/src/app.ts');
    expect(blocks[0].oldText).toBe('foo');
    expect(blocks[0].newText).toBe('bar');
  });

  it('extracts multiple edit blocks', () => {
    const text = [
      '**tool:** `Edit`\n```json\n{"file_path": "a.ts", "old_string": "a", "new_string": "b"}\n```',
      'Some text between',
      '**tool:** `edit`\n```json\n{"path": "c.ts", "oldText": "c", "newText": "d"}\n```',
    ].join('\n');
    const blocks = extractEditBlocks(text);
    expect(blocks).toHaveLength(2);
  });

  it('handles both field naming conventions', () => {
    const text1 = '**tool:** `Edit`\n```json\n{"file_path": "f", "old_string": "a", "new_string": "b"}\n```';
    const text2 = '**tool:** `Edit`\n```json\n{"path": "f", "oldText": "a", "newText": "b"}\n```';

    expect(extractEditBlocks(text1)[0].oldText).toBe('a');
    expect(extractEditBlocks(text2)[0].oldText).toBe('a');
  });

  it('extracts nested edits arrays from real edit tool payloads', () => {
    const text = '**tool:** `edit`\n```json\n{"path":"2026-04-20.md","edits":[{"oldText":"foo","newText":"bar"},{"oldText":"baz","newText":"qux"}]}\n```';

    const blocks = extractEditBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ filePath: '2026-04-20.md', oldText: 'foo', newText: 'bar' });
    expect(blocks[1]).toEqual({ filePath: '2026-04-20.md', oldText: 'baz', newText: 'qux' });
  });

  it('uses per-edit path when present inside nested edits', () => {
    const text = '**tool:** `edit`\n```json\n{"path":"fallback.md","edits":[{"path":"nested.md","oldText":"a","newText":"b"}]}\n```';

    const blocks = extractEditBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ filePath: 'nested.md', oldText: 'a', newText: 'b' });
  });

  it('skips malformed JSON', () => {
    const text = '**tool:** `Edit`\n```json\n{not valid json}\n```';
    expect(extractEditBlocks(text)).toHaveLength(0);
  });

  it('skips blocks with no old or new text', () => {
    const text = '**tool:** `Edit`\n```json\n{"file_path": "f"}\n```';
    expect(extractEditBlocks(text)).toHaveLength(0);
  });

  it('returns empty array for text without edit blocks', () => {
    expect(extractEditBlocks('Just regular text')).toHaveLength(0);
    expect(extractEditBlocks('')).toHaveLength(0);
  });

  it('handles edit blocks case-insensitively (Edit vs edit)', () => {
    const text1 = '**tool:** `Edit`\n```json\n{"old_string": "a", "new_string": "b"}\n```';
    const text2 = '**tool:** `edit`\n```json\n{"old_string": "a", "new_string": "b"}\n```';
    expect(extractEditBlocks(text1)).toHaveLength(1);
    expect(extractEditBlocks(text2)).toHaveLength(1);
  });
});

describe('extractWriteBlocks', () => {
  it('extracts a single write block', () => {
    const text = '**tool:** `Write`\n```json\n{"file_path": "/src/new.ts", "content": "const x = 1;"}\n```';
    const blocks = extractWriteBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].filePath).toBe('/src/new.ts');
    expect(blocks[0].content).toBe('const x = 1;');
  });

  it('extracts multiple write blocks', () => {
    const text = [
      '**tool:** `Write`\n```json\n{"path": "a.ts", "content": "a"}\n```',
      '**tool:** `write`\n```json\n{"file_path": "b.ts", "content": "b"}\n```',
    ].join('\n');
    expect(extractWriteBlocks(text)).toHaveLength(2);
  });

  it('skips blocks with no content', () => {
    const text = '**tool:** `Write`\n```json\n{"file_path": "f"}\n```';
    expect(extractWriteBlocks(text)).toHaveLength(0);
  });

  it('skips malformed JSON', () => {
    const text = '**tool:** `Write`\n```json\n{invalid}\n```';
    expect(extractWriteBlocks(text)).toHaveLength(0);
  });

  it('returns empty array for no write blocks', () => {
    expect(extractWriteBlocks('No blocks here')).toHaveLength(0);
    expect(extractWriteBlocks('')).toHaveLength(0);
  });

  it('handles both field naming conventions', () => {
    const text1 = '**tool:** `Write`\n```json\n{"file_path": "f", "content": "x"}\n```';
    const text2 = '**tool:** `Write`\n```json\n{"path": "f", "content": "x"}\n```';
    expect(extractWriteBlocks(text1)[0].filePath).toBe('f');
    expect(extractWriteBlocks(text2)[0].filePath).toBe('f');
  });
});

describe('apply_patch (Codex harness) support', () => {
  const appServerCall = '**tool:** `apply_patch`\n```json\n' + JSON.stringify({
    changes: [
      {
        path: '/home/ubuntu/nerve/src/a.tsx',
        kind: { type: 'update', move_path: null },
        stat: { added: 2, removed: 1 },
        diff: '@@ -26,3 +26,4 @@\n export function FileIcon() {\n-  const ext = one;\n+  // note\n+  const ext = two;\n   return ext;\n',
      },
      {
        path: '/home/ubuntu/nerve/NEW.md',
        kind: { type: 'add' },
        diff: '+# New file\n+hello\n',
      },
    ],
  }) + '\n```';

  it('turns an app-server apply_patch update into a before/after edit block', () => {
    const blocks = extractEditBlocks(appServerCall);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].filePath).toBe('/home/ubuntu/nerve/src/a.tsx');
    expect(blocks[0].oldText).toBe('export function FileIcon() {\n  const ext = one;\n  return ext;\n');
    expect(blocks[0].newText).toBe('export function FileIcon() {\n  // note\n  const ext = two;\n  return ext;\n');
  });

  it('turns an app-server apply_patch add into a write block', () => {
    const blocks = extractWriteBlocks(appServerCall);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].filePath).toBe('/home/ubuntu/nerve/NEW.md');
    expect(blocks[0].content).toBe('# New file\nhello\n');
  });

  it('parses the CLI Begin Patch format', () => {
    const patch = ['*** Begin Patch', '*** Update File: src/b.ts', '@@', ' const a = 1;', '-const b = 2;', '+const b = 3;', '*** Add File: src/c.ts', '+export const c = 1;', '*** End Patch'].join('\n');
    const text = '**tool:** `apply_patch`\n```json\n' + JSON.stringify({ input: patch }) + '\n```';
    const edits = extractEditBlocks(text);
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('src/b.ts');
    expect(edits[0].oldText).toBe('const a = 1;\nconst b = 2;');
    expect(edits[0].newText).toBe('const a = 1;\nconst b = 3;');
    const writes = extractWriteBlocks(text);
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toBe('export const c = 1;');
  });
});
