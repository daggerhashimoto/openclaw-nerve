import { describe, expect, it } from 'vitest';
import type { Session } from '@/types';
import {
  buildAssigneeOptions,
  buildAssigneeOptionsForEdit,
} from './assigneeOptions';

function session(sessionKey: string, extra: Partial<Session> = {}): Session {
  return { sessionKey, ...extra };
}

describe('assigneeOptions', () => {
  it('puts Unassigned and Operator before alphabetized top-level agent roots', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:reviewer:main', { label: 'Reviewer' }),
      session('agent:designer:main', { displayName: 'Alpha Agent' }),
    ];

    expect(buildAssigneeOptions(sessions, 'Nerve')).toEqual([
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'agent:designer', label: 'designer' },
      { value: 'agent:reviewer', label: 'Reviewer' },
    ]);
  });

  it('maps assignable options to canonical values only', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:builder:main', { label: 'Builder' }),
    ];

    expect(buildAssigneeOptions(sessions, 'Nerve').map((option) => option.value)).toEqual([
      '',
      'operator',
      'agent:builder',
    ]);
  });

  it('uses identity-backed labels for hydrated root agents', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:designer:main', { identityName: 'Designer Prime' }),
    ];

    expect(buildAssigneeOptions(sessions, 'Nerve')).toEqual([
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'agent:designer', label: 'Designer Prime (designer)' },
    ]);
  });

  it('ignores non-top-level sessions', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:builder:main', { label: 'Builder' }),
      session('agent:builder:subagent:child', { label: 'Builder child' }),
      session('agent:builder:cron:daily', { label: 'Daily cron' }),
      session('agent:builder:telegram:direct:123', { displayName: 'Telegram DM' }),
    ];

    expect(buildAssigneeOptions(sessions, 'Nerve')).toEqual([
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'agent:builder', label: 'Builder' },
    ]);
  });

  it('appends a disabled stale-current option in edit mode when the current value is missing from active roots', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:reviewer:main', { label: 'Reviewer' }),
    ];

    expect(buildAssigneeOptionsForEdit(sessions, 'agent:design-reviewer-2', 'Nerve')).toEqual([
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'agent:reviewer', label: 'Reviewer' },
      { value: 'agent:design-reviewer-2', label: 'Agent design reviewer 2 (inactive)', disabled: true },
    ]);
  });

  it('returns no stale option for blank or null current values', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:reviewer:main', { label: 'Reviewer' }),
    ];

    const expected = [
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'agent:reviewer', label: 'Reviewer' },
    ];

    expect(buildAssigneeOptionsForEdit(sessions, '')).toEqual(expected);
    expect(buildAssigneeOptionsForEdit(sessions, '   ')).toEqual(expected);
    expect(buildAssigneeOptionsForEdit(sessions, null)).toEqual(expected);
    expect(buildAssigneeOptionsForEdit(sessions, undefined)).toEqual(expected);
  });

  it('does not duplicate the current value when it is already present', () => {
    const sessions = [
      session('agent:main:main'),
      session('agent:reviewer:main', { label: 'Reviewer' }),
    ];

    expect(buildAssigneeOptionsForEdit(sessions, ' agent:reviewer ')).toEqual([
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'agent:reviewer', label: 'Reviewer' },
    ]);
  });

  it('humanizes fallback stale labels for legacy values when possible', () => {
    const sessions = [
      session('agent:main:main'),
    ];

    expect(buildAssigneeOptionsForEdit(sessions, 'legacy_assignee:qa-bot_2')).toEqual([
      { value: '', label: 'Unassigned' },
      { value: 'operator', label: 'Operator' },
      { value: 'legacy_assignee:qa-bot_2', label: 'Legacy assignee qa bot 2 (inactive)', disabled: true },
    ]);
  });
});
