/**
 * Deterministic simulation of the chat view against a seeded gateway model.
 *
 * Each seed plays a few runs (sent from Nerve and from a channel) through a
 * gateway that delays and reorders its answers, drops the connection, and
 * finishes runs in either order (see src/test/sim/gatewaySim.ts). Once
 * everything has settled, the live view must show what a fresh page load of
 * the same transcript shows, with no run left on screen and no prompt left
 * pending.
 *
 *   npx vitest run src/contexts/ChatContext.sim.test.tsx                  50 seeds, no drops
 *   npm run test:sim                                                      100 seeds with drops
 *   SIM_SEEDS=2000 npx vitest run src/contexts/ChatContext.sim.test.tsx   more seeds
 *   SIM_SEED=1234  npx vitest run src/contexts/ChatContext.sim.test.tsx   one seed, with its trace
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import type { useChat as UseChat } from './ChatContext';
import type { ChatMsg } from '@/features/chat/types';
import { SimGateway, SIM_SESSION, SIM_START, randomConfig, type SimConfig } from '@/test/sim/gatewaySim';

type ChatApi = ReturnType<typeof UseChat>;

const holder: { gateway: SimGateway | null } = { gateway: null };

vi.mock('./GatewayContext', () => ({
  useGateway: () => {
    const gw = holder.gateway!;
    return { connectionState: gw.connectionState, rpc: gw.rpc, subscribe: gw.subscribe };
  },
}));
vi.mock('./SessionContext', () => ({
  useSessionContext: () => ({ currentSession: SIM_SESSION, sessions: [] }),
}));
vi.mock('./SettingsContext', () => ({
  useSettings: () => ({ soundEnabled: false, speak: () => {} }),
}));
vi.mock('@/features/voice/audio-feedback', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  playPing: () => {},
}));

// Plain `vitest` runs 50 seeds without connection drops. Drops are on with
// SIM_SEEDS or SIM_SEED (npm run test:sim, SIM_DROPS=0 to turn them off); one
// finding there is still open: a prompt sent right after a reconnect is hidden
// for a moment when the reconnect's older history read lands.
const withDrops = process.env.SIM_DROPS !== '0' && Boolean(process.env.SIM_SEED || process.env.SIM_SEEDS);
const DEFAULT_SEEDS = withDrops ? 100 : 50;

// No-drop seeds that caught a real regression (an older history read answering
// last and replacing a newer transcript). Any change to the model reshuffles
// what a seed plays, so re-pick these after editing gatewaySim.ts.
const PINNED_SEEDS = [185, 385, 409, 558];

function seedsToRun(): number[] {
  if (process.env.SIM_SEED) return [Number(process.env.SIM_SEED)];
  const count = Number(process.env.SIM_SEEDS ?? DEFAULT_SEEDS);
  const start = Number(process.env.SIM_START_SEED ?? 1);
  const range = Array.from({ length: count }, (_, i) => start + i);
  return withDrops ? range : [...range, ...PINNED_SEEDS.filter((s) => !range.includes(s))];
}

/** What a person sees of a row: who said it and what it says. */
function view(m: ChatMsg) {
  return {
    role: m.role,
    text: m.rawText,
    ...(m.toolGroup ? { tools: m.toolGroup.length } : {}),
    ...(m.intermediate ? { intermediate: true } : {}),
    ...(m.isThinking ? { thinking: true } : {}),
  };
}

/** Settled user and assistant rows on screen, counted by what they say. */
function shownRows(messages: ChatMsg[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if ((m.role !== 'user' && m.role !== 'assistant') || m.pending || m.failed || m.streaming) continue;
    const key = `${m.role}: ${m.rawText}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(gateway: SimGateway) {
  holder.gateway = gateway;
  const { ChatProvider, useChat } = await import('./ChatContext');
  let chat: ChatApi | null = null;
  function Consumer() {
    const value = useChat();
    useEffect(() => {
      chat = value;
    }, [value]);
    return null;
  }
  const tree = () => (
    <ChatProvider>
      <Consumer />
    </ChatProvider>
  );
  const rendered = render(tree());
  return {
    getChat: () => chat!,
    rerender: () => rendered.rerender(tree()),
    unmount: () => rendered.unmount(),
  };
}

/** Let the gateway answer everything outstanding and every timer run out. */
async function settle(gw: SimGateway) {
  for (let quietMs = 0, guard = 0; quietMs < 20_000 && guard < 5_000; guard++) {
    if (gw.canDeliver) {
      await act(async () => gw.deliverNext());
      quietMs = 0;
    } else if (gw.canAnswer) {
      gw.answerOne();
    } else if (gw.canHandle) {
      gw.handleOne();
    } else if (gw.runActive) {
      gw.stepRun();
    } else {
      await tick(1_000);
      quietMs += 1_000;
    }
  }
}

interface SimResult {
  live: ReturnType<typeof view>[];
  cold: ReturnType<typeof view>[];
  problems: string[];
  trace: string[];
  config: SimConfig;
}

async function simulate(seed: number): Promise<SimResult> {
  const gw = new SimGateway(seed, [
    { role: 'user', text: 'Earlier question' },
    { role: 'assistant', text: 'Earlier answer' },
  ]);
  const config = { ...randomConfig(gw.rng), ...(withDrops ? {} : { drops: 0 }) };
  gw.trace.push(`seed ${seed} ${JSON.stringify(config)}`);
  const app = await mount(gw);
  await settle(gw);

  let nerveLeft = config.nerveRuns;
  let channelLeft = config.channelRuns;
  let offlineSteps = 0;
  let dropsLeft = config.drops;
  const sendsOut: Promise<void>[] = [];
  // The transcript only grows, so a row once on screen must stay there.
  let shown = shownRows(app.getChat().messages);
  let vanished: string | null = null;

  for (let step = 0; step < 2_000; step++) {
    const connected = gw.connectionState === 'connected';
    const chat = app.getChat();
    const canSend = connected && nerveLeft > 0 && gw.idle && !gw.sendInFlight && !chat.isGenerating;
    const canChannel = connected && channelLeft > 0 && gw.idle && !gw.sendInFlight;
    if (!canSend && !canChannel && nerveLeft + channelLeft === 0 && !gw.runActive && gw.idle && connected) break;

    const weights = [
      connected && gw.canDeliver ? 5 : 0, // 0 deliver a frame or answer
      connected && gw.canHandle ? 3 : 0, // 1 gateway handles a request
      connected && gw.canAnswer ? 3 : 0, // 2 gateway sends an answer
      gw.runActive ? 3 : 0, // 3 run takes a step
      3, // 4 time passes
      canSend ? 1 : 0, // 5 user sends
      canChannel ? 1 : 0, // 6 a channel message arrives
      connected && dropsLeft > 0 ? 0.2 : 0, // 7 connection drops
      !connected && offlineSteps > 3 ? 2 : 0, // 8 reconnect
    ];
    const overdue = connected ? gw.overdue() : null;
    const action = overdue === 'deliver' ? 0 : overdue === 'handle' ? 1 : overdue === 'answer' ? 2 : gw.rng.weighted(weights);
    if (!connected) offlineSteps++;

    switch (action) {
      case 0:
        await act(async () => gw.deliverNext());
        break;
      case 1:
        gw.handleOne();
        break;
      case 2:
        gw.answerOne();
        break;
      case 3:
        // Tools run and the model streams: a step of a run takes real time.
        gw.stepRun();
        await tick(gw.rng.int(20, 1_500));
        break;
      case 4:
        await tick(gw.rng.int(1, 400));
        break;
      case 5: {
        nerveLeft--;
        const text = `Question ${config.nerveRuns - nerveLeft}`;
        gw.trace.push(`user types ${JSON.stringify(text)}`);
        await act(async () => {
          sendsOut.push(app.getChat().handleSend(text).catch(() => {}));
        });
        break;
      }
      case 6:
        channelLeft--;
        gw.startChannelRun();
        break;
      case 7:
        gw.drop();
        dropsLeft--;
        offlineSteps = 0;
        await act(async () => app.rerender());
        break;
      case 8:
        gw.reconnect();
        await act(async () => app.rerender());
        break;
    }
    await tick(0);

    const now = shownRows(app.getChat().messages);
    for (const [row, count] of shown) {
      if (!vanished && (now.get(row) ?? 0) < count) {
        vanished = `a row left the screen at step ${step}: ${JSON.stringify(row.slice(0, 70))}`;
        gw.trace.push(`!! ${vanished}`);
      }
    }
    shown = now;
  }

  if (gw.connectionState !== 'connected') {
    gw.reconnect();
    await act(async () => app.rerender());
  }
  await settle(gw);
  await act(async () => {
    await Promise.all(sendsOut);
  });

  const chat = app.getChat();
  const problems: string[] = [];
  if (vanished) problems.push(vanished);
  if (chat.isGenerating) problems.push('a run is still on screen (isGenerating)');
  if (chat.stream.html) problems.push(`a stream is still showing: ${JSON.stringify(chat.stream.html.slice(0, 60))}`);
  const pending = chat.messages.filter((m) => m.pending);
  if (pending.length) problems.push(`prompts still pending: ${pending.map((m) => m.rawText).join(', ')}`);
  const ghosts = chat.messages.filter((m) => m.failed && m.tempId && gw.acceptedSends.has(m.tempId));
  if (ghosts.length) problems.push(`shown as failed but the gateway ran them: ${ghosts.map((m) => m.rawText).join(', ')}`);

  // Prompts that never reached the gateway stay on screen as failed, with their
  // error notice; a fresh load cannot know about them.
  const unsent = new Set(chat.messages.filter((m) => m.failed && !(m.tempId && gw.acceptedSends.has(m.tempId))));
  const live = chat.messages
    .filter((m) => !unsent.has(m) && !(m.role === 'system' && m.rawText.startsWith('Send error')))
    .map(view);
  app.unmount();

  // The oracle: a fresh page load of the transcript the gateway ended with.
  const fresh = new SimGateway(seed);
  fresh.transcript.push(...structuredClone(gw.transcript));
  const coldApp = await mount(fresh);
  await settle(fresh);
  const cold = coldApp.getChat().messages.map(view);
  coldApp.unmount();

  return { live, cold, problems, trace: gw.trace, config };
}

describe('chat view under a simulated gateway', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    vi.setSystemTime(SIM_START);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    holder.gateway = null;
  });

  it.each(seedsToRun())('seed %i ends where a fresh load of its transcript would', async (seed) => {
    const result = await simulate(seed);
    const verbose = Boolean(process.env.SIM_SEED);
    const mismatch = JSON.stringify(result.live) !== JSON.stringify(result.cold);
    if (mismatch || result.problems.length || verbose) {
      const report = [
        `seed ${seed} ${JSON.stringify(result.config)}`,
        ...result.problems.map((p) => `problem: ${p}`),
        mismatch ? 'live view differs from a fresh load:' : 'live view matches a fresh load',
        `  live: ${JSON.stringify(result.live)}`,
        `  cold: ${JSON.stringify(result.cold)}`,
        `reproduce: SIM_SEED=${seed} npx vitest run src/contexts/ChatContext.sim.test.tsx`,
        'trace (last 120 lines):',
        ...result.trace.slice(-120).map((l) => `  ${l}`),
      ].join('\n');
      if (verbose) console.log(report);
      expect.soft(result.problems, report).toEqual([]);
      expect(result.live, report).toEqual(result.cold);
    }
  }, 60_000);
});
