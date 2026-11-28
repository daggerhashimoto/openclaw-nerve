import { describe, expect, it, vi } from 'vitest';
import { AGENT_HUES, planAssignments, preferredHueIndex, shadeFor } from './agentColors';

const [mint, lilac] = AGENT_HUES.map((hue) => hue.hex);
const OPERATOR = '#FFA567';

describe('planAssignments', () => {
  it('gives each agent its preferred hue when free, whatever order the views saw them in', () => {
    const a = planAssignments({}, ['main', 'patch', 'review']);
    const b = planAssignments({}, ['review', 'main', 'patch']);
    expect(a).toEqual(b);
    expect(new Set(Object.values(a)).size).toBe(3);
    expect(a.main).toBe(AGENT_HUES[preferredHueIndex('main')].hex);
  });

  it('a second device with no storage plans the same hues', () => {
    const ids = ['main', 'linus', 'lifestyle', 'designer'];
    expect(planAssignments({}, ids)).toEqual(planAssignments({}, [...ids].reverse()));
  });

  it('never gives an agent the operator cantaloupe', () => {
    expect(AGENT_HUES.map((hue) => hue.hex.toUpperCase())).not.toContain(OPERATOR);
    const plan = planAssignments({}, ['main', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(Object.values(plan).map((hex) => hex.toUpperCase())).not.toContain(OPERATOR);
  });

  it('wraps around once every hue is in use, reusing the least-used one', () => {
    const ids = ['main', 'a', 'b', 'c', 'd', 'e', 'f'];
    const plan = planAssignments({}, ids);
    expect(new Set(Object.values(plan)).size).toBe(AGENT_HUES.length);
    const counts = Object.values(plan).reduce<Record<string, number>>((acc, hex) => ({ ...acc, [hex]: (acc[hex] ?? 0) + 1 }), {});
    expect(Math.max(...Object.values(counts))).toBe(2);
  });

  it('never changes an existing assignment', () => {
    const plan = planAssignments({ main: lilac }, ['main', 'patch']);
    expect(plan.main).toBe(lilac);
    expect(plan.patch).not.toBe(lilac);
  });
});

describe('stored hues', () => {
  it('forgets a remembered cantaloupe so the agent takes a free hue', async () => {
    localStorage.setItem('nerve:agent-colors', JSON.stringify({ main: OPERATOR, patch: mint }));
    vi.resetModules();
    const fresh = await import('./agentColors');
    // The store kept patch's pick and dropped main's cantaloupe; main takes the least-used hue.
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => fresh.useAgentHues(['main', 'patch']));
    expect(result.current.hueFor('patch')).toBe(mint);
    expect(result.current.hueFor('main')).toBe(lilac);
    expect(result.current.assignments).toEqual({ patch: mint, main: lilac });
    localStorage.clear();
  });
});

describe('shadeFor', () => {
  it('keeps the root hue and lightens children by depth', () => {
    expect(shadeFor(mint, 0)).toBe(mint);
    expect(shadeFor(mint, 1)).toContain('62%');
    expect(shadeFor(mint, 2)).toContain('44%');
  });
});
