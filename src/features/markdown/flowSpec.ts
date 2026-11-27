/**
 * Parser and deterministic layout for `flow` fenced code blocks.
 *
 * The wire format is JSON. It is deliberately small so an assistant can emit it
 * reliably and the renderer never needs a general graph library:
 *
 * ```flow
 * {
 *   "title": "Decision flow",
 *   "subtitle": "One request, three lanes",
 *   "nodes": [
 *     { "id": "in", "label": "Incoming task", "detail": "user message", "icon": "inbox" },
 *     { "id": "route", "label": "Decision layer", "detail": "classify · score · route", "icon": "git-branch", "tone": "live" },
 *     { "id": "small", "label": "Small model", "detail": "simple tasks", "icon": "zap", "tone": "operator" },
 *     { "id": "strong", "label": "Strong model", "detail": "complex tasks", "icon": "brain", "tone": "purple" },
 *     { "id": "verify", "label": "Execution + verification", "detail": "tests, policies", "icon": "shield-check" }
 *   ],
 *   "edges": [
 *     { "from": "in", "to": "route" },
 *     { "from": "route", "to": "small", "label": "simple", "kind": "branch" },
 *     { "from": "route", "to": "strong", "label": "complex", "kind": "branch" },
 *     { "from": "small", "to": "verify" },
 *     { "from": "strong", "to": "verify" },
 *     { "from": "verify", "to": "route", "label": "retry", "kind": "return" }
 *   ],
 *   "groups": [{ "label": "Decision", "nodes": ["route"] }]
 * }
 * ```
 *
 * Contract:
 * - `nodes` is required; 1..40 unique ids. `label` is required (1..120 chars).
 * - `edges` is optional; 0..120 unique `from`/`to` pairs that must name real
 *   nodes. `kind` is `flow` (default), `branch` (presentational) or `return`
 *   (drawn as a footnote, never as an arrow through other rows).
 * - `groups` is optional; a caption is printed above the earliest row that
 *   contains one of its nodes. Grouping is annotation, not a layout constraint.
 * - `icon` and `tone` are cosmetic and degrade to no icon / neutral; an unknown
 *   icon or tone does not invalidate the block. Unknown structural fields fail
 *   the parse, and the caller falls back to a normal code block.
 * - With no edges, nodes stack as a linear chain in declaration order.
 * - Cycles are allowed. Edges that would point back up the layout are treated
 *   as return links and listed beneath the diagram instead of being drawn
 *   across it.
 */

export const FLOW_TONES = ['neutral', 'live', 'operator', 'green', 'purple', 'red'] as const;
export type FlowTone = (typeof FLOW_TONES)[number];

/** Icons the renderer knows how to draw. Unknown names degrade to no icon. */
export const FLOW_ICON_NAMES = [
  'alert',
  'bot',
  'brain',
  'check',
  'check-circle',
  'circle',
  'clock',
  'cloud',
  'code',
  'cpu',
  'database',
  'eye',
  'file',
  'filter',
  'gauge',
  'git-branch',
  'git-merge',
  'globe',
  'inbox',
  'layers',
  'lock',
  'message',
  'package',
  'plug',
  'refresh',
  'route',
  'scale',
  'search',
  'send',
  'server',
  'settings',
  'shield',
  'sparkles',
  'split',
  'terminal',
  'user',
  'workflow',
  'wrench',
  'zap',
] as const;
export type FlowIconName = (typeof FLOW_ICON_NAMES)[number];

export type FlowEdgeKind = 'flow' | 'branch' | 'return';

export interface FlowNodeSpec {
  id: string;
  label: string;
  detail?: string;
  icon?: FlowIconName;
  tone: FlowTone;
}

export interface FlowEdgeSpec {
  from: string;
  to: string;
  label?: string;
  kind: FlowEdgeKind;
}

export interface FlowGroupSpec {
  label: string;
  nodes: string[];
}

export interface FlowSpec {
  title?: string;
  subtitle?: string;
  nodes: FlowNodeSpec[];
  edges: FlowEdgeSpec[];
  groups: FlowGroupSpec[];
}

export type FlowParseResult =
  | { ok: true; spec: FlowSpec }
  | { ok: false; error: string };

export interface FlowLayoutItem {
  id: string;
  /** Null marks a pass-through lane used by an edge that spans several rows. */
  node: FlowNodeSpec | null;
  order: number;
}

export interface FlowSegment {
  from: string;
  to: string;
  label?: string;
  edge: FlowEdgeSpec;
}

export interface FlowLayout {
  /** One array of items per row, top to bottom. */
  levels: FlowLayoutItem[][];
  /** `segments[i]` connects `levels[i]` to `levels[i + 1]`. */
  segments: FlowSegment[][];
  /** Edges that cannot be drawn downward (explicit or cycle-broken). */
  returns: FlowEdgeSpec[];
  /** Group captions, positioned on the earliest row that holds a member. */
  groups: Array<{ label: string; level: number }>;
}

const LIMITS = {
  source: 64_000,
  nodes: 40,
  edges: 120,
  groups: 8,
  id: 64,
  label: 120,
  detail: 240,
  edgeLabel: 60,
  groupLabel: 80,
  title: 140,
  subtitle: 240,
} as const;

/** Internal ids for pass-through lanes start with NUL, which node ids may not. */
const VIRTUAL_PREFIX = '\u0000flow:';

class FlowSpecError extends Error {}

function fail(message: string): never {
  throw new FlowSpecError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) fail(`${field} is too long (max ${max} characters)`);
  return trimmed;
}

function requiredString(value: unknown, field: string, max: number): string {
  const parsed = optionalString(value, field, max);
  if (!parsed) fail(`${field} is required`);
  return parsed;
}

function normalizeTone(value: unknown): FlowTone {
  if (typeof value !== 'string') return 'neutral';
  const normalized = value.trim().toLowerCase();
  return (FLOW_TONES as readonly string[]).includes(normalized)
    ? (normalized as FlowTone)
    : 'neutral';
}

function normalizeIcon(value: unknown): FlowIconName | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return (FLOW_ICON_NAMES as readonly string[]).includes(normalized)
    ? (normalized as FlowIconName)
    : undefined;
}

function validateFlowSpec(raw: unknown): FlowSpec {
  if (!isRecord(raw)) fail('Flow spec must be a JSON object');

  const title = optionalString(raw.title, 'title', LIMITS.title);
  const subtitle = optionalString(raw.subtitle, 'subtitle', LIMITS.subtitle);

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    fail('nodes must be a non-empty array');
  }
  if (raw.nodes.length > LIMITS.nodes) {
    fail(`nodes is limited to ${LIMITS.nodes} entries`);
  }

  const ids = new Set<string>();
  const nodes: FlowNodeSpec[] = raw.nodes.map((value, index) => {
    if (!isRecord(value)) fail(`nodes[${index}] must be an object`);
    const id = requiredString(value.id, `nodes[${index}].id`, LIMITS.id);
    if (id.includes('\u0000')) fail(`nodes[${index}].id contains an invalid character`);
    if (ids.has(id)) fail(`duplicate node id "${id}"`);
    ids.add(id);

    return {
      id,
      label: requiredString(value.label, `nodes[${index}].label`, LIMITS.label),
      detail: optionalString(value.detail, `nodes[${index}].detail`, LIMITS.detail),
      icon: normalizeIcon(value.icon),
      tone: normalizeTone(value.tone),
    };
  });

  let edges: FlowEdgeSpec[] = [];
  if (raw.edges !== undefined) {
    if (!Array.isArray(raw.edges)) fail('edges must be an array');
    if (raw.edges.length > LIMITS.edges) fail(`edges is limited to ${LIMITS.edges} entries`);

    const seen = new Set<string>();
    edges = raw.edges.map((value, index) => {
      if (!isRecord(value)) fail(`edges[${index}] must be an object`);
      const from = requiredString(value.from, `edges[${index}].from`, LIMITS.id);
      const to = requiredString(value.to, `edges[${index}].to`, LIMITS.id);
      if (!ids.has(from)) fail(`edges[${index}].from references unknown node "${from}"`);
      if (!ids.has(to)) fail(`edges[${index}].to references unknown node "${to}"`);
      if (from === to) fail(`edges[${index}] cannot connect "${from}" to itself`);

      const key = `${from}\u0000${to}`;
      if (seen.has(key)) fail(`duplicate edge "${from}" → "${to}"`);
      seen.add(key);

      const kindRaw = optionalString(value.kind, `edges[${index}].kind`, 16);
      let kind: FlowEdgeKind = 'flow';
      if (kindRaw !== undefined) {
        if (kindRaw === 'flow' || kindRaw === 'branch' || kindRaw === 'return') {
          kind = kindRaw;
        } else {
          fail(`edges[${index}].kind must be "flow", "branch" or "return"`);
        }
      }

      return {
        from,
        to,
        label: optionalString(value.label, `edges[${index}].label`, LIMITS.edgeLabel),
        kind,
      };
    });
  }

  let groups: FlowGroupSpec[] = [];
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) fail('groups must be an array');
    if (raw.groups.length > LIMITS.groups) fail(`groups is limited to ${LIMITS.groups} entries`);

    groups = raw.groups.map((value, index) => {
      if (!isRecord(value)) fail(`groups[${index}] must be an object`);
      const label = requiredString(value.label, `groups[${index}].label`, LIMITS.groupLabel);
      if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        fail(`groups[${index}].nodes must be a non-empty array`);
      }
      const members: string[] = [];
      value.nodes.forEach((member, memberIndex) => {
        if (typeof member !== 'string') {
          fail(`groups[${index}].nodes[${memberIndex}] must be a string`);
        }
        if (!ids.has(member)) {
          fail(`groups[${index}] references unknown node "${member}"`);
        }
        if (!members.includes(member)) members.push(member);
      });
      return { label, nodes: members };
    });
  }

  return { title, subtitle, nodes, edges, groups };
}

/** Parse a fenced `flow` payload. Never throws: invalid input returns ok:false. */
export function parseFlowSpec(source: string): FlowParseResult {
  if (typeof source !== 'string' || source.length > LIMITS.source) {
    return { ok: false, error: 'Flow spec is too large' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: 'Flow spec is not valid JSON' };
  }

  try {
    return { ok: true, spec: validateFlowSpec(raw) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof FlowSpecError ? error.message : 'Invalid flow spec',
    };
  }
}

/**
 * Assign rows, virtual pass-through lanes and connector segments.
 *
 * Ranks come from a deterministic longest-path pass over a Kahn ordering.
 * Cycles are broken at the first unprocessed node in declaration order; any
 * edge that ends up pointing at an equal or earlier row becomes a return link.
 */
export function layoutFlow(spec: FlowSpec): FlowLayout {
  const ranks = new Map<string, number>();
  spec.nodes.forEach((node) => {
    ranks.set(node.id, 0);
  });

  const outgoing = new Map<string, FlowEdgeSpec[]>();
  spec.nodes.forEach((node) => outgoing.set(node.id, []));
  spec.edges.forEach((edge) => outgoing.get(edge.from)?.push(edge));

  const returns: FlowEdgeSpec[] = [];
  const forward: FlowEdgeSpec[] = [];
  for (const edge of spec.edges) {
    if (edge.kind === 'return') returns.push(edge);
    else forward.push(edge);
  }

  if (forward.length === 0) {
    // No drawable connections: present the declaration order as a linear chain.
    spec.nodes.forEach((node, index) => ranks.set(node.id, index));
  } else {
    const indegree = new Map<string, number>();
    spec.nodes.forEach((node) => indegree.set(node.id, 0));
    forward.forEach((edge) => {
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    });

    const queue = spec.nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id);
    const processed = new Set<string>();

    while (processed.size < spec.nodes.length) {
      let current = queue.shift();
      if (current === undefined) {
        // Cycle: force the earliest unprocessed node, seeded by any processed
        // predecessors, so the rest of the graph can drain.
        const next = spec.nodes.find((node) => !processed.has(node.id));
        if (!next) break;
        current = next.id;
        let base = 0;
        for (const edge of forward) {
          if (edge.to === current && processed.has(edge.from)) {
            base = Math.max(base, (ranks.get(edge.from) ?? 0) + 1);
          }
        }
        ranks.set(current, Math.max(ranks.get(current) ?? 0, base));
      }

      if (processed.has(current)) continue;
      processed.add(current);

      for (const edge of outgoing.get(current) ?? []) {
        if (edge.kind === 'return' || processed.has(edge.to)) continue;
        ranks.set(edge.to, Math.max(ranks.get(edge.to) ?? 0, (ranks.get(current) ?? 0) + 1));
        const remaining = (indegree.get(edge.to) ?? 1) - 1;
        indegree.set(edge.to, remaining);
        if (remaining === 0) queue.push(edge.to);
      }
    }
  }

  const forwardEdges = forward.filter(
    (edge) => (ranks.get(edge.to) ?? 0) > (ranks.get(edge.from) ?? 0),
  );
  const backwardEdges = forward.filter((edge) => !forwardEdges.includes(edge));
  returns.push(...backwardEdges);

  const maxRank = spec.nodes.reduce((max, node) => Math.max(max, ranks.get(node.id) ?? 0), 0);
  const levels: FlowLayoutItem[][] = Array.from({ length: maxRank + 1 }, () => []);
  let virtualOrder = spec.nodes.length;
  spec.nodes.forEach((node, index) => {
    levels[ranks.get(node.id) ?? 0].push({ id: node.id, node, order: index });
  });

  // A long edge gets an invisible lane in every row it passes over. The lane
  // keeps the line out of the cards and gives the arrow a non-overlapping path.
  const segments: FlowSegment[][] = Array.from(
    { length: Math.max(0, levels.length - 1) },
    () => [],
  );

  forwardEdges.forEach((edge, edgeIndex) => {
    const fromRank = ranks.get(edge.from) ?? 0;
    const toRank = ranks.get(edge.to) ?? 0;
    const chain = [edge.from];

    for (let rank = fromRank + 1; rank < toRank; rank += 1) {
      const virtualId = `${VIRTUAL_PREFIX}${edgeIndex}:${rank}`;
      chain.push(virtualId);
      levels[rank].push({ id: virtualId, node: null, order: virtualOrder++ });
    }
    chain.push(edge.to);

    for (let index = 0; index < chain.length - 1; index += 1) {
      segments[fromRank + index].push({
        from: chain[index],
        to: chain[index + 1],
        label: index === chain.length - 2 ? edge.label : undefined,
        edge,
      });
    }
  });

  // One barycenter pass: order each row by the average position of its parents
  // in the row above. This keeps fan-outs and merges from crossing themselves.
  for (let levelIndex = 1; levelIndex < levels.length; levelIndex += 1) {
    const previousPositions = new Map(
      levels[levelIndex - 1].map((item, index) => [item.id, index]),
    );
    const weights = new Map<string, number[]>();
    for (const segment of segments[levelIndex - 1]) {
      const parentPosition = previousPositions.get(segment.from);
      if (parentPosition === undefined) continue;
      const bucket = weights.get(segment.to) ?? [];
      bucket.push(parentPosition);
      weights.set(segment.to, bucket);
    }

    levels[levelIndex] = [...levels[levelIndex]].sort((left, right) => {
      const leftWeights = weights.get(left.id);
      const rightWeights = weights.get(right.id);
      const leftAverage = leftWeights?.length
        ? leftWeights.reduce((sum, value) => sum + value, 0) / leftWeights.length
        : null;
      const rightAverage = rightWeights?.length
        ? rightWeights.reduce((sum, value) => sum + value, 0) / rightWeights.length
        : null;

      if (leftAverage === null && rightAverage === null) return left.order - right.order;
      if (leftAverage === null) return 1;
      if (rightAverage === null) return -1;
      return leftAverage - rightAverage || left.order - right.order;
    });
  }

  const groups = spec.groups.map((group) => {
    const level = group.nodes.reduce(
      (earliest, id) => Math.min(earliest, ranks.get(id) ?? 0),
      Number.POSITIVE_INFINITY,
    );
    return { label: group.label, level: Number.isFinite(level) ? level : 0 };
  });

  return { levels, segments, returns, groups };
}
