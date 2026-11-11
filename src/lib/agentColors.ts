import { useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * Identity hues for agent families. The lit colours keep their meaning (blue is
 * work in progress, cantaloupe is the operator or work waiting on them, red is
 * an error); an agent's hue shows in the glass of its pane while the light is
 * off, so idle rows and facade windows still say which family they belong to.
 * Subagents and cron children take lighter shades of their parent's hue.
 *
 * Hues are assigned once per agent id on first sight, least-used first, with the
 * main agent pinned to cantaloupe, and remembered in localStorage so they never
 * shuffle. The operator can override any of them.
 */
export const AGENT_HUES = [
  { hex: '#FFA567', name: 'Cantaloupe' },
  { hex: '#7CC99A', name: 'Mint' },
  { hex: '#B9A7FF', name: 'Lilac' },
  { hex: '#7FD1C7', name: 'Aqua' },
  { hex: '#FF7A9E', name: 'Rose' },
  { hex: '#F2D46B', name: 'Lemon' },
  { hex: '#6FC3F7', name: 'Sky' },
] as const;

export type AgentHueHex = (typeof AGENT_HUES)[number]['hex'];

const STORAGE_KEY = 'nerve:agent-colors';
const MAIN_AGENT_ID = 'main';

type Assignments = Readonly<Record<string, string>>;

function readStored(): Assignments {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [id, hex] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) out[id] = hex;
    }
    return out;
  } catch {
    return {};
  }
}

let assignments: Assignments = readStored();
const listeners = new Set<() => void>();

function commit(next: Assignments): void {
  assignments = next;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be full or disabled; the in-memory assignment still holds for this page.
    }
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Assignments {
  return assignments;
}

/**
 * Pure planner: extend `existing` with hues for every id in `ids` that lacks one.
 * Main takes cantaloupe when it is free; everyone else takes the least-used hue,
 * ties broken by palette order. Deterministic for a given input order, so the
 * first paint can show the same hue the store will remember.
 */
export function planAssignments(existing: Assignments, ids: readonly string[]): Assignments {
  const next: Record<string, string> = { ...existing };
  const counts = new Map<string, number>(AGENT_HUES.map((hue) => [hue.hex, 0]));
  for (const hex of Object.values(next)) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  const cantaloupe = AGENT_HUES[0].hex;

  for (const id of ids) {
    if (next[id]) continue;
    let pick: string | undefined;
    if (id === MAIN_AGENT_ID && (counts.get(cantaloupe) ?? 0) === 0) {
      pick = cantaloupe;
    } else {
      // Cantaloupe stays reserved for main until main has a hue, whichever id shows up first.
      const reserve = next[MAIN_AGENT_ID] ? 0 : 1;
      let best = Number.POSITIVE_INFINITY;
      for (const hue of AGENT_HUES) {
        const used = (counts.get(hue.hex) ?? 0) + (hue.hex === cantaloupe ? reserve : 0);
        if (used < best) {
          best = used;
          pick = hue.hex;
        }
      }
    }
    if (!pick) pick = AGENT_HUES[0].hex;
    next[id] = pick;
    counts.set(pick, (counts.get(pick) ?? 0) + 1);
  }
  return next;
}

/** Operator override: remember a hue for one agent. */
export function setAgentHue(agentId: string, hex: string): void {
  if (assignments[agentId] === hex) return;
  commit({ ...assignments, [agentId]: hex });
}

/** Lighter shade of a family hue for children: depth 1 and deeper step toward white. */
export function shadeFor(hex: string, depth: number): string {
  if (depth <= 0) return hex;
  const keep = depth === 1 ? 62 : 44;
  return `color-mix(in srgb, ${hex} ${keep}%, white)`;
}

/** Test hook: forget every assignment. */
export function resetAgentHues(): void {
  commit({});
}

/**
 * Subscribe to the assignments and make sure every id in `agentIds` has one.
 * `hueFor` answers from the store, or from the same plan the store is about
 * to commit, so there is no colourless first frame.
 */
export function useAgentHues(agentIds: readonly string[]): { hueFor: (agentId: string) => string; assignments: Assignments } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const planned = useMemo(() => planAssignments(snapshot, agentIds), [snapshot, agentIds]);

  // Plan against the live map when the effect runs, not the render's snapshot: two hooks
  // rendering from the same empty store would otherwise each commit a full map and the
  // second would drop the first's agents. `snapshot` stays a dependency so a reset refills.
  useEffect(() => {
    const next = planAssignments(assignments, agentIds);
    if (Object.keys(next).length !== Object.keys(assignments).length) commit(next);
  }, [agentIds, snapshot]);

  const hueFor = useMemo(
    () => (agentId: string) => planned[agentId] ?? planAssignments(planned, [agentId])[agentId],
    [planned],
  );

  return { hueFor, assignments: snapshot };
}

/**
 * Style for a name set in its family hue. The colour goes through a custom property so the
 * stylesheet can darken it on Daylight, where a raw identity hue would fail contrast on paper.
 */
export function nameHueStyle(hue?: string): React.CSSProperties | undefined {
  return hue ? ({ '--name-hue': hue } as React.CSSProperties) : undefined;
}
