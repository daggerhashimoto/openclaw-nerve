/**
 * A seeded model of an OpenClaw gateway for deterministic simulation tests.
 *
 * One model drives both what the client sees live (event frames) and what a
 * `chat.history` read returns (the transcript as it stood when the gateway
 * handled the read), so a test can compare the two instead of trusting
 * hand-written fixtures. Every choice comes from the seeded generator: the
 * same seed replays the same interleaving.
 *
 * What it perturbs, and only what a real gateway does:
 * - requests are handled later than they are sent, while a run keeps going;
 * - answers go out in any order (an older history read can answer last), each
 *   carrying the transcript from the moment it was handled;
 * - frames on one connection arrive in order, with a per-connection frame seq;
 * - a connection can drop: queued frames and answers are lost, calls still out
 *   are rejected (a send the gateway already took still runs), subscriptions
 *   are forgotten, and the next connection numbers frames from 1 again;
 * - a run spends time between its steps (tools run, the model streams);
 * - runs started from a channel reach only connections subscribed to the session.
 */
import type { GatewayEvent } from '@/types';

export const SIM_SESSION = 'agent:main:main';
export const SIM_START = 1_700_000_015_000;

export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  /** Index chosen with the given weights (zero weights are never chosen). */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0 && weights[i] > 0) return i;
    }
    return weights.findIndex((w) => w > 0);
  }
}

type Row = Record<string, unknown> & { role: string; timestamp: number };
type Audience = 'operator' | 'subscribers';

interface Request {
  id: number;
  connId: number;
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  receivedAt: number;
}

type Delivery = { sentAt: number } & (
  | { kind: 'event'; frame: GatewayEvent }
  | { kind: 'res'; req: Request; payload: unknown }
);

interface Connection {
  id: number;
  frameSeq: number;
  subscribed: Set<string>;
  outbox: Delivery[];
}

interface Run {
  id: string;
  kind: 'nerve' | 'channel';
  prompt: string;
  idempotencyKey?: string;
  seq: number;
  steps: Array<() => void>;
}

export interface SimConfig {
  /** Runs Nerve sends, as prompts the simulated user types. */
  nerveRuns: number;
  /** Runs started from a channel such as Telegram. */
  channelRuns: number;
  /** How many times the connection drops during the seed. */
  drops: number;
}

export function randomConfig(rng: Rng): SimConfig {
  return {
    nerveRuns: rng.int(1, 3),
    channelRuns: rng.int(0, 2),
    drops: rng.pick([0, 0, 1, 2]),
  };
}

export class SimGateway {
  readonly rng: Rng;
  readonly trace: string[] = [];
  readonly transcript: Row[] = [];
  connectionState: 'connected' | 'reconnecting' = 'connected';
  /** Idempotency keys of sends the gateway accepted, whether or not the client heard back. */
  readonly acceptedSends = new Set<string>();

  private handler: ((msg: GatewayEvent) => void) | null = null;
  private conn: Connection | null;
  private connCount = 0;
  private reqCount = 0;
  private rowCount = 0;
  private runCount = 0;
  private inbox: Request[] = [];
  private answered: Delivery[] = [];
  private active: Run | null = null;
  private queued: Run[] = [];

  constructor(seed: number, initialRows: Array<{ role: 'user' | 'assistant'; text: string }> = []) {
    this.rng = new Rng(seed);
    this.conn = this.newConnection();
    for (const row of initialRows) {
      if (row.role === 'user') this.commit({ role: 'user', content: row.text, timestamp: Date.now() - 60_000 });
      else this.commit({ role: 'assistant', content: [{ type: 'text', text: row.text }], timestamp: Date.now() - 60_000 });
    }
  }

  // ─── Client side (what useGateway exposes) ────────────────────────────────

  readonly rpc = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const conn = this.conn;
    if (!conn) return Promise.reject(new Error('Not connected'));
    return new Promise((resolve, reject) => {
      const req: Request = { id: ++this.reqCount, connId: conn.id, method, params, resolve, reject, receivedAt: Date.now() };
      this.inbox.push(req);
      this.log(`client -> ${method}#${req.id}`);
    });
  };

  readonly subscribe = (handler: (msg: GatewayEvent) => void): (() => void) => {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  };

  // ─── What the scheduler can do next ───────────────────────────────────────

  get canDeliver(): boolean {
    return (this.conn?.outbox.length ?? 0) > 0;
  }
  get canHandle(): boolean {
    return this.inbox.length > 0;
  }
  get canAnswer(): boolean {
    return this.answered.length > 0;
  }
  get runActive(): boolean {
    return this.active !== null;
  }
  get idle(): boolean {
    return !this.active && this.queued.length === 0;
  }
  get quiet(): boolean {
    return this.idle && !this.canDeliver && !this.canHandle && !this.canAnswer;
  }
  get sendInFlight(): boolean {
    return this.inbox.some((r) => r.method === 'chat.send')
      || this.answered.some((d) => d.kind === 'res' && d.req.method === 'chat.send')
      || (this.conn?.outbox.some((d) => d.kind === 'res' && d.req.method === 'chat.send') ?? false);
  }

  /**
   * Work a real gateway would not leave waiting this long: frames reach the
   * client within 250 ms, a request is taken within 1.5 s, and an answer goes
   * out within 2 s of being taken. Reordering stays inside those bounds.
   */
  overdue(): 'deliver' | 'handle' | 'answer' | null {
    const now = Date.now();
    const head = this.conn?.outbox[0];
    if (head && now - head.sentAt > 250) return 'deliver';
    if (this.inbox.some((r) => now - r.receivedAt > 1_500)) return 'handle';
    if (this.answered.some((d) => now - d.sentAt > 2_000)) return 'answer';
    return null;
  }

  /**
   * Hand the client the next frames on the connection: everything the gateway
   * sent at the same moment arrives together, as it would on one socket.
   */
  deliverNext(): void {
    const outbox = this.conn!.outbox;
    const sentAt = outbox[0].sentAt;
    while (outbox.length > 0 && outbox[0].sentAt === sentAt) {
      const d = outbox.shift()!;
      if (d.kind === 'event') {
        this.log(`deliver ${describeFrame(d.frame)}`);
        this.handler?.(d.frame);
      } else {
        this.log(`deliver res ${d.req.method}#${d.req.id}`);
        d.req.resolve(d.payload);
      }
    }
  }

  /** The gateway takes one request it has received, in any order (an overdue one first). */
  handleOne(): void {
    const late = this.inbox.findIndex((r) => Date.now() - r.receivedAt > 1_500);
    const idx = late >= 0 ? late : this.rng.int(0, this.inbox.length - 1);
    const [req] = this.inbox.splice(idx, 1);
    const payload = this.handle(req);
    this.log(`handle ${req.method}#${req.id}`);
    // sentAt holds when it was taken until the answer goes out.
    this.answered.push({ kind: 'res', req, payload, sentAt: Date.now() });
  }

  /** One handled answer goes out on the connection, in any order (an overdue one first). */
  answerOne(): void {
    const late = this.answered.findIndex((d) => Date.now() - d.sentAt > 2_000);
    const idx = late >= 0 ? late : this.rng.int(0, this.answered.length - 1);
    const [d] = this.answered.splice(idx, 1);
    this.conn!.outbox.push({ ...d, sentAt: Date.now() });
  }

  /** The active run takes its next step. */
  stepRun(): void {
    const run = this.active!;
    const step = run.steps.shift()!;
    step();
    if (run.steps.length === 0) {
      this.log(`run ${run.id} done`);
      this.active = null;
      const next = this.queued.shift();
      if (next) this.activate(next);
    }
  }

  startChannelRun(): void {
    this.activate(this.buildRun('channel', `Channel message ${this.runCount + 1}`));
  }

  /** The connection drops. */
  drop(): void {
    const conn = this.conn!;
    this.log(`DROP connection ${conn.id}`);
    const lost = [
      ...this.inbox,
      ...this.answered.map((d) => (d as { req: Request }).req),
      ...conn.outbox.filter((d): d is Extract<Delivery, { kind: 'res' }> => d.kind === 'res').map((d) => d.req),
    ];
    this.inbox = [];
    this.answered = [];
    this.conn = null;
    this.connectionState = 'reconnecting';
    for (const req of lost) req.reject(new Error('WebSocket disconnected'));
  }

  reconnect(): void {
    this.conn = this.newConnection();
    this.connectionState = 'connected';
    this.log(`connected ${this.conn.id}`);
  }

  // ─── Gateway internals ────────────────────────────────────────────────────

  private newConnection(): Connection {
    return { id: ++this.connCount, frameSeq: 0, subscribed: new Set(), outbox: [] };
  }

  private log(line: string): void {
    this.trace.push(`${new Date(Date.now()).toISOString().slice(14, 23)} ${line}`);
  }

  private handle(req: Request): unknown {
    const { method, params } = req;
    if (method === 'chat.history') {
      const limit = typeof params.limit === 'number' ? params.limit : 200;
      const running = this.active !== null || this.queued.length > 0;
      return {
        sessionKey: SIM_SESSION,
        messages: structuredClone(this.transcript.slice(-limit)),
        sessionInfo: { key: SIM_SESSION, hasActiveRun: running, ...(running ? { status: 'running' } : {}) },
      };
    }
    if (method === 'chat.send') {
      const key = String(params.idempotencyKey);
      this.acceptedSends.add(key);
      const run = this.buildRun('nerve', String(params.message ?? ''), key);
      if (this.active) this.queued.push(run);
      else this.activate(run);
      return { runId: run.id, status: 'started' };
    }
    if (method === 'sessions.messages.subscribe') {
      if (this.conn && this.conn.id === req.connId) this.conn.subscribed.add(String(params.key));
      return { subscribed: true, key: params.key, agentId: 'main' };
    }
    if (method === 'sessions.messages.unsubscribe') {
      if (this.conn && this.conn.id === req.connId) this.conn.subscribed.delete(String(params.key));
      return {};
    }
    return {};
  }

  private emit(event: string, payload: Record<string, unknown>, audience: Audience): void {
    const conn = this.conn;
    if (!conn) {
      this.log(`(lost, offline) ${event}`);
      return;
    }
    if (audience === 'subscribers' && !conn.subscribed.has(SIM_SESSION)) {
      this.log(`(not sent, unsubscribed) ${event}`);
      return;
    }
    conn.outbox.push({ kind: 'event', sentAt: Date.now(), frame: { type: 'event', event, payload, seq: ++conn.frameSeq } as GatewayEvent });
  }

  private commit(row: Row): Row {
    const id = `r${++this.rowCount}`;
    const meta = { ...(row.__openclaw as object | undefined), id, seq: this.transcript.length + 1 };
    const stored = { ...row, __openclaw: meta };
    this.transcript.push(stored);
    return stored;
  }

  private commitAndNotify(row: Row, runId?: string): Row {
    const stored = this.commit(row);
    const meta = stored.__openclaw as { id: string; seq: number };
    this.log(`commit ${row.role} ${JSON.stringify(previewText(row)).slice(0, 40)}`);
    this.emit('session.message', {
      sessionKey: SIM_SESSION,
      agentId: 'main',
      message: structuredClone(stored),
      messageId: meta.id,
      messageSeq: meta.seq,
      ...(runId ? { runId } : {}),
    }, 'subscribers');
    return stored;
  }

  private activate(run: Run): void {
    this.active = run;
    this.log(`run ${run.id} (${run.kind}) starts`);
  }

  private buildRun(kind: Run['kind'], prompt: string, idempotencyKey?: string): Run {
    const n = ++this.runCount;
    const run: Run = { id: `run-${n}`, kind, prompt, idempotencyKey, seq: 0, steps: [] };
    const audience: Audience = kind === 'nerve' ? 'operator' : 'subscribers';
    const rng = this.rng;
    const agent = (stream: string, data: Record<string, unknown>) => ({
      runId: run.id, sessionKey: SIM_SESSION, agentId: 'main', seq: ++run.seq, stream, data,
    });
    const chat = (payload: Record<string, unknown>) => ({
      runId: run.id, sessionKey: SIM_SESSION, agentId: 'main', seq: ++run.seq, ...payload,
    });
    const s = run.steps;

    s.push(() => {
      this.commitAndNotify({
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
        ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:user` } : {}),
      });
    });
    s.push(() => this.emit('agent', agent('lifecycle', { phase: 'start', startedAt: Date.now() }), audience));
    s.push(() => this.emit('chat', chat({ state: 'status', phase: 'preparing_workspace' }), audience));

    const tools = rng.int(0, 2);
    for (let t = 1; t <= tools; t++) {
      const callId = `${run.id}-tc${t}`;
      const narrate = rng.chance(0.5);
      s.push(() => this.emit('agent', agent('tool', { phase: 'start', name: 'exec', toolCallId: callId, args: { command: `ls ${t}` } }), audience));
      s.push(() => {
        this.commitAndNotify({
          role: 'assistant',
          content: [
            ...(narrate ? [{ type: 'text', text: `Checking step ${t} of run ${n}.` }] : []),
            { type: 'toolCall', id: callId, name: 'exec', arguments: { command: `ls ${t}` } },
          ],
          timestamp: Date.now(),
          __openclaw: { runId: run.id },
        }, run.id);
      });
      s.push(() => this.emit('agent', agent('tool', { phase: 'result', name: 'exec', toolCallId: callId }), audience));
      s.push(() => {
        this.commitAndNotify({
          role: 'toolResult',
          toolCallId: callId,
          toolName: 'exec',
          content: [{ type: 'text', text: `output ${t}` }],
          timestamp: Date.now(),
          __openclaw: { runId: run.id },
        }, run.id);
      });
      s.push(() => this.emit('agent', agent('item', { kind: 'tool', phase: 'end', toolCallId: callId }), audience));
    }

    const words = `Reply ${n} says the sky is clear and the build is green.`.split(' ');
    const cuts = rng.int(2, 4);
    const chunks: string[] = [];
    for (let c = 0; c < cuts; c++) {
      const from = Math.floor((c * words.length) / cuts);
      const to = Math.floor(((c + 1) * words.length) / cuts);
      chunks.push((c === 0 ? '' : ' ') + words.slice(from, to).join(' '));
    }
    const reply = chunks.join('');
    chunks.forEach((chunk, c) => {
      s.push(() => {
        const soFar = chunks.slice(0, c + 1).join('');
        this.emit('chat', chat({
          state: 'delta',
          deltaText: chunk,
          ...(c === 0 ? { message: { role: 'assistant', content: [{ type: 'text', text: soFar }], timestamp: Date.now() } } : {}),
        }), audience);
      });
    });

    let replyRow: Row | null = null;
    s.push(() => {
      replyRow = this.commitAndNotify({
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
        timestamp: Date.now(),
        __openclaw: { runId: run.id },
      }, run.id);
    });
    const final = () => this.emit('chat', chat({
      state: 'final',
      stopReason: 'stop',
      message: { role: 'assistant', content: [{ type: 'text', text: reply }], timestamp: replyRow!.timestamp },
    }), audience);
    const end = () => this.emit('agent', agent('lifecycle', { phase: 'end', endedAt: Date.now() }), audience);
    // OpenClaw 2026.9 broadcasts the lifecycle end as soon as the agent turn
    // ends and the final once the reply is dispatched, right after it.
    s.push(() => {
      end();
      final();
    });

    return run;
  }
}

function previewText(row: Row): string {
  const content = row.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: { type?: string; text?: string; name?: string }) => b.text ?? `[${b.type}:${b.name ?? ''}]`).join(' ');
  }
  return '';
}

function describeFrame(frame: GatewayEvent): string {
  const p = (frame.payload || {}) as Record<string, unknown>;
  const data = (p.data || {}) as Record<string, unknown>;
  const detail = frame.event === 'chat'
    ? String(p.state)
    : frame.event === 'agent'
      ? `${p.stream}:${data.phase ?? ''}`
      : frame.event === 'session.message'
        ? String((p.message as { role?: string } | undefined)?.role)
        : '';
  return `#${frame.seq} ${frame.event} ${detail}${p.runId ? ` ${p.runId}` : ''}`;
}
