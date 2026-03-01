/** Tests for server-side kanban marker parser. */
import { describe, it, expect } from 'vitest';
import { parseKanbanMarkers, stripKanbanMarkers } from './parseMarkers.js';

describe('parseKanbanMarkers (server)', () => {
  it('parses create markers', () => {
    const text = '[kanban:create]{"title":"New task","priority":"high"}[/kanban:create]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('create');
    expect(markers[0].payload.title).toBe('New task');
    expect(markers[0].payload.priority).toBe('high');
  });

  it('parses update markers', () => {
    const text = '[kanban:update]{"id":"abc-123","status":"done"}[/kanban:update]';
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].type).toBe('update');
    expect(markers[0].payload.id).toBe('abc-123');
  });

  it('returns empty for no markers', () => {
    expect(parseKanbanMarkers('just plain text')).toEqual([]);
    expect(parseKanbanMarkers('')).toEqual([]);
  });

  it('skips invalid JSON', () => {
    const text = '[kanban:create]{not valid json}[/kanban:create]';
    expect(parseKanbanMarkers(text)).toEqual([]);
  });

  it('skips create without title', () => {
    const text = '[kanban:create]{"priority":"high"}[/kanban:create]';
    expect(parseKanbanMarkers(text)).toEqual([]);
  });

  it('skips update without id', () => {
    const text = '[kanban:update]{"status":"done"}[/kanban:update]';
    expect(parseKanbanMarkers(text)).toEqual([]);
  });

  it('enforces max 5 markers', () => {
    const marker = '[kanban:create]{"title":"t"}[/kanban:create]';
    const text = Array(8).fill(marker).join('\n');
    expect(parseKanbanMarkers(text)).toHaveLength(5);
  });

  it('parses multiple mixed markers', () => {
    const text = [
      '[kanban:create]{"title":"Task A"}[/kanban:create]',
      '[kanban:update]{"id":"123","title":"Updated"}[/kanban:update]',
    ].join('\n');
    const markers = parseKanbanMarkers(text);
    expect(markers).toHaveLength(2);
    expect(markers[0].type).toBe('create');
    expect(markers[1].type).toBe('update');
  });
});

describe('stripKanbanMarkers', () => {
  it('removes markers from text', () => {
    const text = 'Before.\n[kanban:create]{"title":"New"}[/kanban:create]\nAfter.';
    const clean = stripKanbanMarkers(text);
    expect(clean).not.toContain('[kanban:');
    expect(clean).toContain('Before.');
    expect(clean).toContain('After.');
  });

  it('collapses excessive newlines after stripping', () => {
    const text = 'Before.\n\n\n[kanban:create]{"title":"New"}[/kanban:create]\n\n\nAfter.';
    const clean = stripKanbanMarkers(text);
    expect(clean).not.toMatch(/\n{3,}/);
  });

  it('returns empty/falsy text as-is', () => {
    expect(stripKanbanMarkers('')).toBe('');
  });

  it('returns text unchanged when no markers', () => {
    const text = 'Just a normal result.';
    expect(stripKanbanMarkers(text)).toBe(text);
  });

  it('strips multiple markers', () => {
    const text = [
      'Start.',
      '[kanban:create]{"title":"A"}[/kanban:create]',
      'Middle.',
      '[kanban:update]{"id":"x","status":"done"}[/kanban:update]',
      'End.',
    ].join('\n');
    const clean = stripKanbanMarkers(text);
    expect(clean).not.toContain('[kanban:');
    expect(clean).toContain('Start.');
    expect(clean).toContain('Middle.');
    expect(clean).toContain('End.');
  });
});
