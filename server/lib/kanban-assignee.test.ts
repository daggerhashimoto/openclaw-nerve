/**
 * Tests for shared Kanban assignee normalization helpers.
 * @module
 */

import { describe, expect, it } from 'vitest';
import {
  InvalidKanbanAssigneeError,
  canonicalizeKanbanAssignee,
  resolveKanbanAssigneeRootSessionKey,
} from './kanban-assignee.js';

describe('canonicalizeKanbanAssignee', () => {
  it('keeps canonical agent assignees unchanged', () => {
    expect(canonicalizeKanbanAssignee('agent:designer')).toBe('agent:designer');
  });

  it('collapses legacy main-session assignees to the canonical agent id', () => {
    expect(canonicalizeKanbanAssignee('agent:designer:main')).toBe('agent:designer');
  });

  it('collapses nested subagent assignees to the canonical agent id', () => {
    expect(canonicalizeKanbanAssignee('agent:designer:subagent:child')).toBe('agent:designer');
  });

  it('preserves operator and unset assignees', () => {
    expect(canonicalizeKanbanAssignee('operator')).toBe('operator');
    expect(canonicalizeKanbanAssignee(undefined)).toBeUndefined();
    expect(canonicalizeKanbanAssignee(null)).toBeUndefined();
  });

  it('rejects reserved or malformed assignee values', () => {
    expect(() => canonicalizeKanbanAssignee('agent:main')).toThrow(InvalidKanbanAssigneeError);
    expect(() => canonicalizeKanbanAssignee('reviewer')).toThrow('Invalid Kanban assignee: reviewer');
  });
});

describe('resolveKanbanAssigneeRootSessionKey', () => {
  it('returns null for operator and unset assignees', () => {
    expect(resolveKanbanAssigneeRootSessionKey('operator')).toBeNull();
    expect(resolveKanbanAssigneeRootSessionKey(undefined)).toBeNull();
    expect(resolveKanbanAssigneeRootSessionKey(null)).toBeNull();
  });

  it('maps canonical and legacy agent values to the owning root session', () => {
    expect(resolveKanbanAssigneeRootSessionKey('agent:designer')).toBe('agent:designer:main');
    expect(resolveKanbanAssigneeRootSessionKey('agent:designer:main')).toBe('agent:designer:main');
    expect(resolveKanbanAssigneeRootSessionKey('agent:designer:subagent:child')).toBe('agent:designer:main');
  });

  it('returns null for reserved or malformed values', () => {
    expect(resolveKanbanAssigneeRootSessionKey('agent:main')).toBeNull();
    expect(resolveKanbanAssigneeRootSessionKey('reviewer')).toBeNull();
  });
});
