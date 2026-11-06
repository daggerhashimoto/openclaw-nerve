import { describe, expect, it } from 'vitest';
import { AGENT_HUES, planAssignments, shadeFor } from './agentColors';

const [cantaloupe, mint, lilac] = AGENT_HUES.map((hue) => hue.hex);

describe('planAssignments', () => {
  it('pins main to cantaloupe and hands the others out least-used first', () => {
    const plan = planAssignments({}, ['main', 'patch', 'review']);
    expect(plan).toEqual({ main: cantaloupe, patch: mint, review: lilac });
  });

  it('keeps cantaloupe for main even when another agent is seen first', () => {
    const first = planAssignments({}, ['patch']);
    expect(first.patch).toBe(mint);
    const then = planAssignments(first, ['main']);
    expect(then.main).toBe(cantaloupe);
  });

  it('wraps around once every hue is in use, reusing the least-used one', () => {
    const ids = ['main', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const plan = planAssignments({}, ids);
    expect(new Set(Object.values(plan)).size).toBe(AGENT_HUES.length);
    expect(plan.g).toBe(cantaloupe);
  });

  it('never changes an existing assignment', () => {
    const plan = planAssignments({ main: lilac }, ['main', 'patch']);
    expect(plan.main).toBe(lilac);
    expect(plan.patch).toBe(cantaloupe);
  });
});

describe('shadeFor', () => {
  it('keeps the root hue and lightens children by depth', () => {
    expect(shadeFor(cantaloupe, 0)).toBe(cantaloupe);
    expect(shadeFor(cantaloupe, 1)).toContain('62%');
    expect(shadeFor(cantaloupe, 2)).toContain('44%');
  });
});
