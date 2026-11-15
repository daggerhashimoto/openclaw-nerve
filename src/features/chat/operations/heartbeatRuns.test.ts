import { describe, it, expect } from 'vitest';
import { HeartbeatRuns } from './heartbeatRuns';
import type { GatewayEvent } from '@/types';

const MAIN = 'agent:main:main';
const frame = (event: string, payload: Record<string, unknown>): GatewayEvent => ({ type: 'event', event, payload });
const lifecycle = (runId: string, phase: string, isHeartbeat?: boolean) => frame('agent', {
  runId, sessionKey: MAIN, stream: 'lifecycle', data: { phase }, ...(isHeartbeat !== undefined ? { isHeartbeat } : {}),
});

describe('HeartbeatRuns', () => {
  it('knows a heartbeat from its flagged agent frames and its chat frames by run id', () => {
    const runs = new HeartbeatRuns();

    expect(runs.observe(lifecycle('hb', 'start', true))).toEqual({ runId: 'hb', sessionKey: MAIN, ended: false });
    expect(runs.running(MAIN)).toBe(true);
    expect(runs.observe(frame('chat', { runId: 'hb', sessionKey: MAIN, state: 'delta' }))).toEqual({ runId: 'hb', sessionKey: MAIN, ended: false });
    // An agent frame of the same run that lacks the flag still belongs to it.
    expect(runs.observe(lifecycle('hb', 'end'))).toEqual({ runId: 'hb', sessionKey: MAIN, ended: true });
    expect(runs.running(MAIN)).toBe(false);
    // The final follows the lifecycle end and is still the heartbeat's.
    expect(runs.observe(frame('chat', { runId: 'hb', sessionKey: MAIN, state: 'final' }))).toEqual({ runId: 'hb', sessionKey: MAIN, ended: true });
  });

  it('leaves other runs and events alone', () => {
    const runs = new HeartbeatRuns();
    runs.observe(lifecycle('hb', 'start', true));

    expect(runs.observe(lifecycle('tg', 'start', false))).toBeNull();
    expect(runs.observe(frame('chat', { runId: 'tg', sessionKey: MAIN, state: 'final' }))).toBeNull();
    expect(runs.observe(frame('session.message', { runId: 'hb', sessionKey: MAIN }))).toBeNull();
    expect(runs.observe(frame('agent', { sessionKey: MAIN, stream: 'lifecycle', data: { phase: 'start' }, isHeartbeat: true }))).toBeNull();
  });

  it('ends a heartbeat on a chat final, abort or error when its lifecycle end is missing', () => {
    for (const state of ['final', 'aborted', 'error']) {
      const runs = new HeartbeatRuns();
      runs.observe(lifecycle('hb', 'start', true));
      expect(runs.observe(frame('chat', { runId: 'hb', sessionKey: MAIN, state }))?.ended).toBe(true);
      expect(runs.running(MAIN)).toBe(false);
    }
  });

  it('tracks whether a heartbeat runs per session, and forgets runs under way on settle', () => {
    const runs = new HeartbeatRuns();
    runs.observe(lifecycle('hb', 'start', true));

    expect(runs.running('agent:ops:main')).toBe(false);
    runs.settle();
    expect(runs.running(MAIN)).toBe(false);
    // The run is still known as a heartbeat.
    expect(runs.observe(frame('chat', { runId: 'hb', sessionKey: MAIN, state: 'final' }))).not.toBeNull();
  });

  it('remembers a bounded number of runs', () => {
    const runs = new HeartbeatRuns(2);
    for (const id of ['a', 'b', 'c']) {
      runs.observe(lifecycle(id, 'start', true));
      runs.observe(lifecycle(id, 'end', true));
    }

    expect(runs.observe(frame('chat', { runId: 'a', sessionKey: MAIN, state: 'final' }))).toBeNull();
    expect(runs.observe(frame('chat', { runId: 'c', sessionKey: MAIN, state: 'final' }))).not.toBeNull();
  });
});
