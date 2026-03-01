/** Tests for kanban marker parser. */
import { describe, it, expect } from 'vitest';
import { parseKanbanMarkers } from './parseMarkers';

describe('parseKanbanMarkers', () => {
  // ── Valid markers ──────────────────────────────────────────────────

  it('parses a valid create marker', () => {
    const text = 'Some text [kanban:create]{"title":"Fix login bug","priority":"high","labels":["bug"]}[/kanban:create] more text';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('create');
    expect(markers[0].payload).toEqual({
      title: 'Fix login bug',
      priority: 'high',
      labels: ['bug'],
    });
    expect(markers[0].raw).toContain('[kanban:create]');
    expect(markers[0].raw).toContain('[/kanban:create]');
  });

  it('parses a valid update marker', () => {
    const text = '[kanban:update]{"id":"abc-123","status":"done","result":"Fixed the bug"}[/kanban:update]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('update');
    expect(markers[0].payload).toEqual({
      id: 'abc-123',
      status: 'done',
      result: 'Fixed the bug',
    });
  });

  it('parses multiple markers', () => {
    const text = [
      '[kanban:create]{"title":"Task 1"}[/kanban:create]',
      '[kanban:update]{"id":"x","status":"done"}[/kanban:update]',
      '[kanban:create]{"title":"Task 2"}[/kanban:create]',
    ].join('\n');
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(3);
    expect(markers[0].type).toBe('create');
    expect(markers[1].type).toBe('update');
    expect(markers[2].type).toBe('create');
  });

  it('handles markers with whitespace around JSON', () => {
    const text = '[kanban:create]  {"title":"Spaced"}  [/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].payload.title).toBe('Spaced');
  });

  it('handles create marker with only title (minimal)', () => {
    const text = '[kanban:create]{"title":"Minimal"}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].payload.title).toBe('Minimal');
  });

  // ── Malformed JSON ─────────────────────────────────────────────────

  it('ignores marker with malformed JSON', () => {
    const text = '[kanban:create]{bad json}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('ignores marker with truncated JSON', () => {
    const text = '[kanban:create]{"title":"trunc[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('ignores marker with array payload', () => {
    const text = '[kanban:create][1,2,3][/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('ignores marker with string payload', () => {
    const text = '[kanban:create]"just a string"[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('ignores marker with null payload', () => {
    const text = '[kanban:create]null[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  // ── Missing required fields ────────────────────────────────────────

  it('rejects create marker without title', () => {
    const text = '[kanban:create]{"priority":"high"}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('rejects create marker with empty title', () => {
    const text = '[kanban:create]{"title":""}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('rejects create marker with whitespace-only title', () => {
    const text = '[kanban:create]{"title":"   "}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('rejects update marker without id', () => {
    const text = '[kanban:update]{"status":"done"}[/kanban:update]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('rejects update marker with empty id', () => {
    const text = '[kanban:update]{"id":"","status":"done"}[/kanban:update]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  // ── Nested / escaped markers ───────────────────────────────────────

  it('ignores mismatched opening/closing tags', () => {
    const text = '[kanban:create]{"title":"Test"}[/kanban:update]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('ignores unclosed markers', () => {
    const text = '[kanban:create]{"title":"Unclosed"}';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('handles marker-like content inside JSON strings gracefully', () => {
    // The regex is non-greedy so it will match up to the first valid closing tag
    const text = '[kanban:create]{"title":"Has [kanban:update] in title"}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    // Will try to parse the JSON — may or may not succeed depending on regex match
    // The key is it doesn't crash
    expect(markers.length).toBeLessThanOrEqual(1);
  });

  // ── Safety limits ──────────────────────────────────────────────────

  it('truncates at 5 markers', () => {
    const parts: string[] = [];
    for (let i = 0; i < 8; i++) {
      parts.push(`[kanban:create]{"title":"Task ${i}"}[/kanban:create]`);
    }
    const markers = parseKanbanMarkers(parts.join('\n'));
    expect(markers).toHaveLength(5);
  });

  it('skips payload exceeding 2KB', () => {
    const bigString = 'x'.repeat(3000);
    const text = `[kanban:create]{"title":"${bigString}"}[/kanban:create]`;
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(0);
  });

  it('keeps markers under 2KB limit', () => {
    const smallString = 'x'.repeat(100);
    const text = `[kanban:create]{"title":"${smallString}"}[/kanban:create]`;
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  it('returns empty array for empty string', () => {
    expect(parseKanbanMarkers('')).toEqual([]);
  });

  it('returns empty array for null-ish input', () => {
    expect(parseKanbanMarkers(undefined as unknown as string)).toEqual([]);
    expect(parseKanbanMarkers(null as unknown as string)).toEqual([]);
  });

  it('returns empty array for text with no markers', () => {
    expect(parseKanbanMarkers('Hello, world!')).toEqual([]);
  });

  it('valid and invalid markers mixed — only valid ones returned', () => {
    const text = [
      '[kanban:create]{"title":"Valid"}[/kanban:create]',
      '[kanban:create]{broken}[/kanban:create]',
      '[kanban:update]{"id":"ok","status":"done"}[/kanban:update]',
      '[kanban:create]{"priority":"high"}[/kanban:create]', // missing title
    ].join('\n');
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe('create');
    expect(markers[0].payload.title).toBe('Valid');
    expect(markers[1].type).toBe('update');
    expect(markers[1].payload.id).toBe('ok');
  });
});
