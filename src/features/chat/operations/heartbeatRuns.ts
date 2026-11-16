/**
 * heartbeatRuns: tell a heartbeat's frames apart from those of the runs Nerve shows.
 *
 * The gateway marks every agent frame of a heartbeat run (lifecycle, item,
 * thinking, commentary) with `isHeartbeat: true`, but its chat frames carry no
 * flag. A run is therefore remembered from its first flagged agent frame, and
 * its later frames, the chat delta and final included, are matched by run id.
 */
import type { GatewayEvent } from '@/types';

export interface HeartbeatFrame {
  runId: string;
  sessionKey?: string;
  /** The frame ends the run: a lifecycle end or error, or a chat final, abort or error. */
  ended: boolean;
}

const REMEMBERED_RUNS = 32;
const TERMINAL_CHAT_STATES = new Set(['final', 'aborted', 'error']);

interface FramePayload {
  runId?: unknown;
  sessionKey?: unknown;
  isHeartbeat?: unknown;
  stream?: unknown;
  state?: unknown;
  data?: { phase?: unknown };
}

export class HeartbeatRuns {
  /** Heartbeat run ids, oldest first */
  private readonly known = new Set<string>();
  /** Heartbeat runs started and not over yet, with their session */
  private readonly underWay = new Map<string, string | undefined>();

  private readonly limit: number;

  constructor(limit = REMEMBERED_RUNS) {
    this.limit = limit;
  }

  /** The heartbeat frame this event is, or null when it is not one. */
  observe(event: GatewayEvent): HeartbeatFrame | null {
    if (event.event !== 'agent' && event.event !== 'chat') return null;
    const payload = (event.payload || {}) as FramePayload;
    const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
    if (!runId) return null;
    const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined;

    if (event.event === 'agent' && payload.isHeartbeat === true) this.remember(runId);
    if (!this.known.has(runId)) return null;

    let ended: boolean;
    if (event.event === 'agent') {
      const phase = payload.stream === 'lifecycle' ? payload.data?.phase : undefined;
      ended = phase === 'end' || phase === 'error';
      // Any agent frame short of the end shows the run under way, also after a
      // settle or when its start frame was missed. A chat frame does not: the
      // last delta can follow the lifecycle end.
      if (!ended) this.underWay.set(runId, sessionKey);
    } else {
      ended = typeof payload.state === 'string' && TERMINAL_CHAT_STATES.has(payload.state);
    }
    if (ended) this.underWay.delete(runId);
    return { runId, sessionKey, ended };
  }

  /** Whether a heartbeat is under way on the session. */
  running(sessionKey: string): boolean {
    for (const key of this.underWay.values()) {
      if (key === sessionKey) return true;
    }
    return false;
  }

  /** Forget the runs under way, after their end frames may have been lost. */
  settle(): void {
    this.underWay.clear();
  }

  private remember(runId: string): void {
    if (this.known.has(runId)) return;
    this.known.add(runId);
    if (this.known.size > this.limit) {
      const oldest = this.known.values().next().value as string;
      this.known.delete(oldest);
      this.underWay.delete(oldest);
    }
  }
}
