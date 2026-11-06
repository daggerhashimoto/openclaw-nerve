import { describe, expect, it } from 'vitest';
import type { GranularAgentState } from '@/types';
import {
  getSessionPaneState,
  getStatusBadgeClasses,
  getStatusBadgeText,
  getStatusPaneState,
} from './statusUtils';

const at = (state: Omit<GranularAgentState, 'since'>): GranularAgentState => ({ since: 0, ...state });

describe('statusUtils', () => {
  it('maps granular states to pane states', () => {
    expect(getStatusPaneState(at({ status: 'THINKING' }))).toBe('live');
    expect(getStatusPaneState(at({ status: 'STREAMING' }))).toBe('live');
    expect(getStatusPaneState(at({ status: 'THINKING', toolName: 'exec' }))).toBe('live');
    expect(getStatusPaneState(at({ status: 'ERROR' }))).toBe('error');
    expect(getStatusPaneState(at({ status: 'DONE' }))).toBe('off');
    expect(getStatusPaneState(at({ status: 'IDLE' }))).toBe('off');
  });

  it('uses plain sentence-case text instead of caps badges', () => {
    expect(getStatusBadgeText(at({ status: 'THINKING' }))).toBe('thinking');
    expect(getStatusBadgeText(at({ status: 'STREAMING', toolName: 'web_search' }))).toBe('web_search');
    expect(getStatusBadgeText(at({ status: 'IDLE' }))).toBe('idle');
  });

  it('returns text colours without pulsing pill classes', () => {
    expect(getStatusBadgeClasses(at({ status: 'STREAMING' }))).toBe('text-live-text');
    expect(getStatusBadgeClasses(at({ status: 'ERROR' }))).toBe('text-destructive');
    expect(getStatusBadgeClasses(at({ status: 'DONE' }))).toBe('text-muted-foreground');
    for (const status of ['IDLE', 'THINKING', 'STREAMING', 'DONE', 'ERROR'] as const) {
      expect(getStatusBadgeClasses(at({ status }))).not.toMatch(/animate-pulse|bg-/);
    }
  });

  it('resolves a session pane: error beats live beats waiting on you', () => {
    expect(getSessionPaneState({ running: true })).toBe('live');
    expect(getSessionPaneState({ running: false, unread: true })).toBe('operator');
    expect(getSessionPaneState({ running: false })).toBe('off');
    expect(getSessionPaneState({ running: true, unread: true, granularStatus: at({ status: 'ERROR' }) })).toBe('error');
    expect(getSessionPaneState({ running: true, unread: true, granularStatus: at({ status: 'STREAMING' }) })).toBe('live');
    expect(getSessionPaneState({ running: false, unread: true, granularStatus: at({ status: 'DONE' }) })).toBe('operator');
    expect(getSessionPaneState({ running: true, granularStatus: at({ status: 'IDLE' }) })).toBe('off');
  });
});
