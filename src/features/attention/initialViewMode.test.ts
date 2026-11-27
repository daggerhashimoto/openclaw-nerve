import { describe, expect, it } from 'vitest';
import { getInitialViewMode } from './initialViewMode';

describe('getInitialViewMode', () => {
  it('getInitialViewMode lands on attention with nothing saved', () => {
    expect(getInitialViewMode(true, { saved: null, introFresh: false })).toBe('attention');
    expect(getInitialViewMode(false, { saved: null, introFresh: true })).toBe('attention');
  });

  it('getInitialViewMode switches existing installs once', () => {
    expect(getInitialViewMode(true, { saved: 'chat', introFresh: true })).toBe('attention');
    expect(getInitialViewMode(true, { saved: 'kanban', introFresh: true })).toBe('attention');
    expect(getInitialViewMode(true, { saved: 'kanban', introFresh: false })).toBe('kanban');
  });

  it('getInitialViewMode keeps a saved chat after the intro', () => {
    expect(getInitialViewMode(true, { saved: 'chat', introFresh: false })).toBe('chat');
    expect(getInitialViewMode(true, { saved: 'attention', introFresh: false })).toBe('attention');
  });

  it('falls back to chat for a saved kanban when kanban is hidden', () => {
    expect(getInitialViewMode(false, { saved: 'kanban', introFresh: false })).toBe('chat');
  });

  it('falls back to attention for an unknown saved value', () => {
    expect(getInitialViewMode(true, { saved: 'board', introFresh: false })).toBe('attention');
  });
});
