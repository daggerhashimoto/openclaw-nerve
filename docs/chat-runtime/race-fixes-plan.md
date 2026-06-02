# Chat-runtime race fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the async-interleaving races on `origin/next` that are confirmed-present, isolated, and mechanically fixable: the client reconnect fan-out/handshake bug, the replay-buffer cross-restart cursor collision, the publish() re-entrancy subscriber-orphan, and the SPA-404 route regression.

**Architecture:** Each fix is a small, local change to a single module plus a failing-first regression test. No cross-module coupling. The chat-runtime subsystem is not yet wired into any route, so server fixes are validated at the module boundary via the existing vitest suites.

**Tech Stack:** TypeScript, vitest (jsdom env, `globals: true`), @testing-library/react for the hook test, Hono for the server app.

**Base:** branch `fix/chat-runtime-races` off `origin/next` (`4dc0ad6`). Worktree: `.worktrees/chat-runtime-races`.

---

## Conventions

- **Run all commands from the worktree root** `.worktrees/chat-runtime-races` (the repo's vitest config excludes `.worktrees/**`, which only matters when run from the main checkout; from inside the worktree the paths resolve normally).
- Single-file test run: `npx vitest run <path>`. Single test: `npx vitest run <path> -t "<name>"`.
- Lint: `npx eslint <path>`.
- Commit per task. PR grouping is noted per task; do not open PRs as part of this plan.

## Scope

**In this plan (confirmed present on next, isolated, mechanical):**
- Task 1 (#9/#10): client `ws.onmessage` generation guard. PR-A.
- Task 2 (#1): replay-buffer per-process epoch in the cursor. PR-B.
- Task 3 (#2): store `publish()` identity-checked cleanup. PR-B.
- Task 4 (SPA-404): known-extension allowlist for the SPA fallback. PR-C.

**Deferred (see end of doc) — not blind-patchable:**
- #3, #7 (runtime active-history hydration): need a design pass; a naive #3 fix breaks the intended finalize-on-reconnect behavior that `runtime.test.ts:65` asserts.
- #4, #8 (reducer terminal-turn handling): `next` added explicit post-finalize behavior + tests; verify before changing.
- #5, #6 (user_message_failed): need an adoptability/type decision integrated with next's `user_message_run_bound` machinery.
- #11: already fixed on next (verified) — dropped.
- Open-lead triage.

## File structure

- `src/hooks/useWebSocket.ts` — add one generation guard in `ws.onmessage`. Test: `src/hooks/useWebSocket.test.ts`.
- `server/lib/chat-runtime/replay-buffer.ts` — epoch token + cursor encoding + replay epoch check. Test: `server/lib/chat-runtime/replay-buffer.test.ts`.
- `server/lib/chat-runtime/store.ts` — thread `epoch` option to `ReplayBuffer`; identity-checked `publish()` cleanup. Test: `server/lib/chat-runtime/store.test.ts`.
- `server/app.ts` — replace the dot-based static check with a known-extension allowlist, extracted to a pure helper. New test: `server/lib/static-route.test.ts` (+ `server/lib/static-route.ts`).

---

## Task 1: Client onmessage generation guard (#9 + #10)

**Files:**
- Modify: `src/hooks/useWebSocket.ts:192`
- Test: `src/hooks/useWebSocket.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe('useWebSocket', ...)` in `src/hooks/useWebSocket.test.ts`:

```typescript
it('ignores frames from a socket superseded by a newer connection', async () => {
  const wsInstances: MockWebSocket[] = [];
  const OriginalMockWS = MockWebSocket;
  (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = class extends OriginalMockWS {
    constructor(url: string) {
      super(url);
      wsInstances.push(this);
    }
  };

  const { result } = renderHook(() => useWebSocket());
  const onEvent = vi.fn();
  act(() => {
    result.current.onEvent.current = onEvent;
  });

  // gen 1 connects and authenticates
  act(() => {
    result.current.connect('ws://localhost:8080', 'test-token').catch(() => {});
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  act(() => {
    simulateAuthHandshake(wsInstances[0]);
  });

  // gen 2 supersedes gen 1
  act(() => {
    result.current.connect('ws://localhost:9090', 'test-token').catch(() => {});
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(wsInstances).toHaveLength(2);
  onEvent.mockClear();

  // a buffered event and a stale challenge arrive on the superseded gen-1 socket
  act(() => {
    wsInstances[0].simulateMessage({ type: 'event', event: 'agent.delta', payload: { text: 'stale' } });
    wsInstances[0].simulateMessage({ type: 'event', event: 'connect.challenge', payload: { nonce: 'stale-nonce' } });
  });

  // #9: the stale event is not fanned out to live subscribers
  expect(onEvent).not.toHaveBeenCalled();

  // #10: the stale challenge did not clobber the live handshake; gen-2 still completes
  act(() => {
    simulateAuthHandshake(wsInstances[1]);
  });
  expect(result.current.connectionState).toBe('connected');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useWebSocket.test.ts -t "ignores frames from a socket superseded"`
Expected: FAIL — `onEvent` is called by the stale `agent.delta`/`connect.challenge` (and/or the stale challenge breaks the gen-2 handshake), because `ws.onmessage` has no generation guard.

- [ ] **Step 3: Add the guard**

In `src/hooks/useWebSocket.ts`, the handler currently begins:

```typescript
      ws.onmessage = (ev) => {
        let msg: GatewayMessage;
        try { msg = JSON.parse(ev.data) as GatewayMessage; } catch { return; }
```

Insert the generation guard as the first statement inside the handler:

```typescript
      ws.onmessage = (ev) => {
        if (gen !== connectionGenRef.current) return;
        let msg: GatewayMessage;
        try { msg = JSON.parse(ev.data) as GatewayMessage; } catch { return; }
```

This mirrors the existing guards at `useWebSocket.ts:178` (connect-timeout) and `:270` (onclose). `gen` is the per-connection value captured at `doConnect` (line 144); `connectionGenRef.current` is the latest connection's generation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useWebSocket.test.ts`
Expected: PASS (new test green, all existing useWebSocket tests still green).

- [ ] **Step 5: Commit (PR-A)**

```bash
git add src/hooks/useWebSocket.ts src/hooks/useWebSocket.test.ts
git commit -m "fix(ws): ignore frames from superseded socket generations"
```

---

## Task 2: Replay-buffer per-process epoch cursor (#1)

**Files:**
- Modify: `server/lib/chat-runtime/replay-buffer.ts`
- Modify: `server/lib/chat-runtime/store.ts` (thread `epoch` option through)
- Test: `server/lib/chat-runtime/replay-buffer.test.ts`, `server/lib/chat-runtime/store.test.ts`

Background: on deploy/restart the module singleton `ReplayBuffer` is recreated empty and `nextCursor` resets to 1, so a new process re-issues cursor `3`. A client resuming with a stale `3` from the previous process gets a pure string match and is handed the wrong generation's patches with no snapshot. Fix: stamp a per-process epoch into the cursor and reject a cursor whose epoch does not match.

- [ ] **Step 1: Write the failing test (cross-generation collision)**

Add to `server/lib/chat-runtime/replay-buffer.test.ts`:

```typescript
it('requires a snapshot when the resume cursor is from an earlier process generation', () => {
  const gen1 = new ReplayBuffer({ maxPatchesPerSession: 5, epoch: 'g1' });
  gen1.append('agent:main:main', [hydrationOp('cold')], 1000);
  gen1.append('agent:main:main', [hydrationOp('hydrating')], 1001);
  const staleCursor = gen1.append('agent:main:main', [hydrationOp('ready')], 1002).cursor;

  // process restart: a fresh buffer (new epoch) rebuilds the same session to the same seq
  const gen2 = new ReplayBuffer({ maxPatchesPerSession: 5, epoch: 'g2' });
  gen2.append('agent:main:main', [hydrationOp('cold')], 2000);
  gen2.append('agent:main:main', [hydrationOp('hydrating')], 2001);
  gen2.append('agent:main:main', [hydrationOp('ready')], 2002);

  expect(staleCursor).toBe('g1:3');
  expect(gen2.replayAfter('agent:main:main', staleCursor)).toEqual({ kind: 'snapshot_required' });
  // a current-generation cursor still replays normally
  const currentCursor = gen2.latestCursor('agent:main:main');
  expect(currentCursor).toBe('g2:3');
  expect(gen2.replayAfter('agent:main:main', currentCursor)).toEqual({ kind: 'patches', patches: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/chat-runtime/replay-buffer.test.ts -t "earlier process generation"`
Expected: FAIL — `ReplayBuffer` has no `epoch` option, cursors are bare `'3'`, so `staleCursor` is `'3'` not `'g1:3'` and `gen2.replayAfter` returns patches instead of `snapshot_required`.

- [ ] **Step 3: Implement the epoch**

In `server/lib/chat-runtime/replay-buffer.ts`:

Add the import at the top:

```typescript
import { randomUUID } from 'node:crypto';
```

Extend the options and constructor:

```typescript
interface ReplayBufferOptions {
  maxPatchesPerSession: number;
  epoch?: string;
}

export class ReplayBuffer {
  private readonly maxPatchesPerSession: number;
  private readonly epoch: string;
  private readonly sessions = new Map<string, SessionReplayLog>();

  constructor(options: ReplayBufferOptions) {
    if (!Number.isSafeInteger(options.maxPatchesPerSession) || options.maxPatchesPerSession <= 0) {
      throw new RangeError('ReplayBuffer maxPatchesPerSession must be a positive safe integer');
    }

    this.maxPatchesPerSession = options.maxPatchesPerSession;
    this.epoch = options.epoch ?? randomUUID();
  }
```

In `append`, encode the epoch into the cursor:

```typescript
    const cursor = `${this.epoch}:${log.nextCursor}`;
    log.nextCursor += 1;
```

In `latestCursor`, return the epoch-qualified cursor (keep `'0'` for unseen sessions):

```typescript
  latestCursor(sessionKey: string): string {
    const log = this.sessions.get(sessionKey);
    if (!log) return '0';
    return `${this.epoch}:${log.nextCursor - 1}`;
  }
```

In `replayAfter`, reject a foreign-epoch cursor before the sequence match, and decode the seq for the cold-start check:

```typescript
  replayAfter(sessionKey: string, cursor?: string | null): ReplayResult {
    if (!cursor) return { kind: 'snapshot_required' };

    if (cursor !== '0') {
      const separator = cursor.indexOf(':');
      if (separator === -1 || cursor.slice(0, separator) !== this.epoch) {
        return { kind: 'snapshot_required' };
      }
    }

    const log = this.sessions.get(sessionKey);
    if (!log) {
      return cursor === '0'
        ? { kind: 'patches', patches: [] }
        : { kind: 'snapshot_required' };
    }

    if (cursor === '0') {
      const firstRetainedCursor = log.patches[0]?.cursor;
      if (!firstRetainedCursor || firstRetainedCursor === `${this.epoch}:1`) {
        return { kind: 'patches', patches: cloneTimelinePatches(log.patches) };
      }

      return { kind: 'snapshot_required' };
    }

    const cursorIndex = log.patches.findIndex((patch) => patch.cursor === cursor);
    if (cursorIndex === -1) return { kind: 'snapshot_required' };

    return {
      kind: 'patches',
      patches: cloneTimelinePatches(log.patches.slice(cursorIndex + 1)),
    };
  }
```

- [ ] **Step 4: Thread the epoch option through the store**

In `server/lib/chat-runtime/store.ts`, extend the options and pass it down:

```typescript
interface ChatTimelineStoreOptions {
  maxPatchesPerSession: number;
  epoch?: string;
}
```

```typescript
  constructor(options: ChatTimelineStoreOptions) {
    this.replayBuffer = new ReplayBuffer(options);
  }
```

(`new ReplayBuffer(options)` already forwards the whole options object, so passing `epoch` through `ChatTimelineStoreOptions` is enough. `singleton.ts` does not pass `epoch`, so production gets a fresh `randomUUID()` per process — exactly the per-generation token we want.)

- [ ] **Step 5: Update existing cursor-format assertions**

The epoch change makes cursors `'<epoch>:<seq>'`. Update the existing tests that pin the bare numeric format to inject a fixed epoch and expect the qualified form.

In `server/lib/chat-runtime/replay-buffer.test.ts`:
- "replays retained patches after cursor": construct `new ReplayBuffer({ maxPatchesPerSession: 3, epoch: 'e1' })` and change `expect([first.cursor, second.cursor, third.cursor]).toEqual(['1', '2', '3'])` to `toEqual(['e1:1', 'e1:2', 'e1:3'])`.
- "uses independent cursor counters per session...": add `epoch: 'e1'`; change `toEqual(['1', '1', '2'])` to `toEqual(['e1:1', 'e1:1', 'e1:2'])`.
- "returns latest cursor for seen sessions and 0 for unseen sessions": add `epoch: 'e1'`; keep `latestCursor('agent:missing:main')` as `'0'`; change the seen expectations to `'e1:1'` and `'e1:2'`.

In `server/lib/chat-runtime/store.test.ts`, for each test that asserts `patch.cursor` / `snapshot.cursor` numeric values (lines ~100-101, 181-183, 196-202, 261-263, 281-282), construct the store with `{ maxPatchesPerSession: N, epoch: 'e1' }` and prefix the expected cursors with `e1:` (e.g. `['1', '2']` -> `['e1:1', 'e1:2']`, `toBe('2')` -> `toBe('e1:2')`). Leave `cursor: '0'` snapshot assertions unchanged (unseen sessions still return `'0'`).

- [ ] **Step 6: Run the full buffer + store suites**

Run: `npx vitest run server/lib/chat-runtime/replay-buffer.test.ts server/lib/chat-runtime/store.test.ts`
Expected: PASS (new collision test green; updated format assertions green; everything else unchanged).

- [ ] **Step 7: Commit (PR-B)**

```bash
git add server/lib/chat-runtime/replay-buffer.ts server/lib/chat-runtime/store.ts server/lib/chat-runtime/replay-buffer.test.ts server/lib/chat-runtime/store.test.ts
git commit -m "fix(chat-runtime): tag replay cursors with a per-process epoch"
```

---

## Task 3: Store publish() identity-checked cleanup (#2)

**Files:**
- Modify: `server/lib/chat-runtime/store.ts:206-221` (the `publish` method)
- Test: `server/lib/chat-runtime/store.test.ts`

Background: `publish` captures the subscriber Set into a local and, after delivery, deletes the map key if that captured Set is empty. If a subscriber synchronously unsubscribes and resubscribes during delivery (a reconnect handler reacting to the patch), the unsubscribe deletes the now-empty `S1` and the resubscribe maps a fresh `S2`; the captured-`S1` empty check then deletes the map key holding `S2`, silently orphaning the new subscriber. Every later publish reads `undefined` and the chat freezes.

- [ ] **Step 1: Write the failing test**

Add to `server/lib/chat-runtime/store.test.ts`:

```typescript
it('keeps re-subscribed listeners when a subscriber resubscribes during delivery', () => {
  const store = new ChatTimelineStore({ maxPatchesPerSession: 10 });
  const sessionKey = 'agent:main:main';
  const received: string[] = [];

  let unsubscribe = store.subscribe(sessionKey, function first(patch) {
    received.push(`first:${patch.cursor}`);
    // react to the first patch by tearing down and re-subscribing (reconnect handler shape)
    unsubscribe();
    unsubscribe = store.subscribe(sessionKey, function second(patch2) {
      received.push(`second:${patch2.cursor}`);
    });
  });

  store.applyEvent(turnStarted(sessionKey, 'run-1', 1000));
  store.applyEvent(assistantDelta(sessionKey, 'run-1', 'hello', 1001));

  // the re-subscribed listener must receive the second patch
  expect(received.some((entry) => entry.startsWith('second:'))).toBe(true);
});
```

(`turnStarted` and `assistantDelta` are existing helpers at the top of `store.test.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/chat-runtime/store.test.ts -t "resubscribes during delivery"`
Expected: FAIL — no `second:` entry, because the captured-Set cleanup deleted the map key holding the re-subscribed listener.

- [ ] **Step 3: Implement identity-checked cleanup**

In `server/lib/chat-runtime/store.ts`, the `publish` method ends with:

```typescript
    if (sessionSubscribers.size === 0) this.subscribers.delete(sessionKey);
```

Replace that final line with an identity- and emptiness-checked delete against the live map entry:

```typescript
    const liveSubscribers = this.subscribers.get(sessionKey);
    if (liveSubscribers === sessionSubscribers && liveSubscribers.size === 0) {
      this.subscribers.delete(sessionKey);
    }
```

This mirrors the fresh re-read already used in the unsubscribe closure at `store.ts:87-91`: only tear down the map entry if it is still the same (now-empty) Set we delivered to, never a freshly re-mapped one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/lib/chat-runtime/store.test.ts`
Expected: PASS (new test green, all existing store tests green).

- [ ] **Step 5: Commit (PR-B)**

```bash
git add server/lib/chat-runtime/store.ts server/lib/chat-runtime/store.test.ts
git commit -m "fix(chat-runtime): identity-check publish cleanup against re-subscribe"
```

---

## Task 4: SPA fallback known-extension allowlist (SPA-404)

**Files:**
- Create: `server/lib/static-route.ts`
- Create: `server/lib/static-route.test.ts`
- Modify: `server/app.ts:106-119`

Background: the SPA fallback treats any path containing a dot as a static file and 404s it (`app.ts:113`: `c.req.path !== '/' && c.req.path.includes('.')`). Client routes that contain a dot (session keys like `agent:main:v1.5`, version segments, encoded ids) are wrongly 404'd instead of serving `index.html`.

- [ ] **Step 1: Write the failing test**

Create `server/lib/static-route.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { isStaticAssetPath } from './static-route.js';

describe('isStaticAssetPath', () => {
  it('treats hashed assets and known static extensions as static', () => {
    expect(isStaticAssetPath('/assets/index-abc123.js')).toBe(true);
    expect(isStaticAssetPath('/favicon.ico')).toBe(true);
    expect(isStaticAssetPath('/logo.svg')).toBe(true);
    expect(isStaticAssetPath('/manifest.webmanifest')).toBe(true);
  });

  it('treats app routes (including dotted ones) as non-static so the SPA shell loads', () => {
    expect(isStaticAssetPath('/')).toBe(false);
    expect(isStaticAssetPath('/sessions/agent:main:v1.5')).toBe(false);
    expect(isStaticAssetPath('/chat/run.123')).toBe(false);
    expect(isStaticAssetPath('/settings')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/lib/static-route.test.ts`
Expected: FAIL — `./static-route.js` / `isStaticAssetPath` does not exist.

- [ ] **Step 3: Implement the allowlist helper**

Create `server/lib/static-route.ts`:

```typescript
// Extensions served as static files from ./dist. Anything else (including dotted
// client routes like `agent:main:v1.5`) falls through to the SPA shell.
const STATIC_ASSET_EXTENSIONS = new Set([
  'js', 'mjs', 'css', 'map', 'json', 'webmanifest',
  'ico', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'wasm', 'txt', 'xml', 'pdf', 'mp3', 'mp4', 'webm',
]);

export function isStaticAssetPath(path: string): boolean {
  if (path.startsWith('/assets/')) return true;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = lastSegment.slice(dot + 1).toLowerCase();
  return STATIC_ASSET_EXTENSIONS.has(ext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/lib/static-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in app.ts**

In `server/app.ts`, add the import near the other imports:

```typescript
import { isStaticAssetPath } from './lib/static-route.js';
```

Replace the SPA fallback body (lines 110-119) so the static check uses the allowlist:

```typescript
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();

  if (isStaticAssetPath(c.req.path)) {
    return c.notFound();
  }

  return serveStatic({ root: './dist/', path: 'index.html' })(c, next);
});
```

- [ ] **Step 6: Lint and run the new test**

Run: `npx eslint server/lib/static-route.ts server/app.ts && npx vitest run server/lib/static-route.test.ts`
Expected: PASS, no lint errors.

- [ ] **Step 7: Commit (PR-C)**

```bash
git add server/lib/static-route.ts server/lib/static-route.test.ts server/app.ts
git commit -m "fix(server): gate SPA 404 on a static-extension allowlist"
```

---

## Deferred — needs a design/verification pass (not in this plan)

These came out of re-verifying the report against `origin/next`. They are real candidates but cannot be blind-patched, because `next` has evolved since the report's snapshot.

- **#3 + #7 — runtime active-history hydration.** A naive #3 fix ("suppress `turn_finalized` while the live turn is `running`") breaks the intended reconnect behavior asserted by `runtime.test.ts:65` (active-history hydration finalizes a bound running turn). The runtime cannot distinguish "running because still streaming live" (the race) from "running because completion hasn't been processed" (legit) by turn status alone. Needs a real signal (e.g. tracking whether a live terminal frame arrived for the run, or a freshness comparison). #7 (fingerprint recorded before bind) lives in the same hydrate flow and should be designed together.

- **#4 + #8 — reducer terminal-turn handling.** `next` added explicit post-finalize behavior and tests ("applies a known tool finish after a turn is finalized without reopening the group" at reducer.test.ts:1287/1305; "ignores late ... after a turn is finalized" at 1249/1268). Verify which part of #4 (terminal group/sibling regression) and #8 (late `assistant_final`/`thinking_final` creating a new item) is still a real gap versus already-handled, before changing `closeToolGroupsForTurn` / `shouldIgnoreEventForTerminalTurn`.

- **#5 + #6 — user_message_failed.** `next` introduced `user_message_run_bound` + `bindRunIdToOptimisticUserMessage`. #6 (skip-fail-when-committed) is simple, but it shares the handler with #5 (keep a failed optimistic prompt adoptable), which needs a marker decision that satisfies `rebindSinglePendingOptimisticPromptTurn`'s filter (`pending === false` and terminal-turn rejection at reducer.ts:396/400) and integrates with the new bind path. Design the handler holistically.

- **#11 — output-boundary tool status.** Already fixed on `next`: `closedToolGroupStatus` falls through to `'running'` (reducer.ts:566) and `closeOpenToolGroupsForOutputBoundary` no longer force-fails children (reducer.ts:569-582), with a pinning test at reducer.test.ts:1430. No action.

- **Open-lead triage.** Re-check the five unverified leads against next (Date.now vs seq ordering, structuredClone on non-cloneable tool payloads, optimisticRunId same-ms collision, per-tab instanceId duplication, active-history-sync RPC failure loop).

## Self-review

- Spec coverage: of the eleven report races, this plan implements the four confirmed-present, isolated ones (#1, #2, #9, #10) plus SPA-404; #11 is verified already-fixed; #3/#4/#5/#6/#7/#8 are explicitly carved out with the specific reason each needs design/verification. No silent gaps.
- Placeholders: none — every step has concrete code and a run command with expected outcome.
- Type/name consistency: `isStaticAssetPath`, `epoch` option on `ReplayBufferOptions` and `ChatTimelineStoreOptions`, and the `gen`/`connectionGenRef` names all match their source definitions.
