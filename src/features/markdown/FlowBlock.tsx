import React from 'react';
import {
  ArrowDown,
  Bot,
  Brain,
  Check,
  Circle,
  CircleCheck,
  Clock,
  Cloud,
  Code,
  Cpu,
  CornerDownLeft,
  Database,
  Eye,
  FileText,
  Filter,
  Gauge,
  GitBranch,
  GitMerge,
  Globe,
  Inbox,
  Layers,
  Lock,
  MessageSquare,
  Package,
  Plug,
  RefreshCw,
  Route,
  Scale,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Split,
  Terminal,
  TriangleAlert,
  User,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  layoutFlow,
  type FlowEdgeSpec,
  type FlowIconName,
  type FlowLayoutItem,
  type FlowNodeSpec,
  type FlowSegment,
  type FlowSpec,
  type FlowTone,
} from './flowSpec';

const FLOW_ICONS: Record<FlowIconName, LucideIcon> = {
  alert: TriangleAlert,
  bot: Bot,
  brain: Brain,
  check: Check,
  'check-circle': CircleCheck,
  circle: Circle,
  clock: Clock,
  cloud: Cloud,
  code: Code,
  cpu: Cpu,
  database: Database,
  eye: Eye,
  file: FileText,
  filter: Filter,
  gauge: Gauge,
  'git-branch': GitBranch,
  'git-merge': GitMerge,
  globe: Globe,
  inbox: Inbox,
  layers: Layers,
  lock: Lock,
  message: MessageSquare,
  package: Package,
  plug: Plug,
  refresh: RefreshCw,
  route: Route,
  scale: Scale,
  search: Search,
  send: Send,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  sparkles: Sparkles,
  split: Split,
  terminal: Terminal,
  user: User,
  workflow: Workflow,
  wrench: Wrench,
  zap: Zap,
};

const TONE_ICON_STYLES: Record<FlowTone, string> = {
  neutral: 'text-muted-foreground',
  live: 'text-live-text',
  operator: 'text-operator-text',
  green: 'text-green',
  purple: 'text-purple',
  red: 'text-red',
};

function FlowNodeCard({ node }: { node: FlowNodeSpec }) {
  const Icon = node.icon ? FLOW_ICONS[node.icon] : undefined;

  return (
    <div className="flow-card flex h-full w-full min-w-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-[4px] border border-border bg-raised px-2.5 py-3.5 text-center">
      {Icon && (
        <Icon
          size={20}
          strokeWidth={1.75}
          className={TONE_ICON_STYLES[node.tone]}
          aria-hidden="true"
        />
      )}
      <div className="flow-card-text flex min-w-0 flex-col items-center gap-2">
        <div className="min-w-0 text-[0.867rem] font-semibold leading-tight text-foreground break-words">
          {node.label}
        </div>
        {node.detail && (
          <div className="min-w-0 text-[0.75rem] leading-snug text-muted-foreground break-words">
            {node.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function centerOf(items: FlowLayoutItem[], id: string): number {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0 || items.length === 0) return 50;
  return ((index + 0.5) / items.length) * 100;
}

/**
 * Orthogonal connectors between two rows. Every edge gets its own horizontal
 * lane, so arrowheads and labels never sit on top of one another; edges that
 * share a source or a destination share one trunk.
 */
function FlowConnectors({
  segments,
  fromItems,
  toItems,
}: {
  segments: FlowSegment[];
  fromItems: FlowLayoutItem[];
  toItems: FlowLayoutItem[];
}) {
  if (segments.length === 0) return null;

  const laneGap = 20;
  const topPad = 14;
  const height = Math.max(36, topPad + (segments.length - 1) * laneGap + 18);
  const laneOf = (index: number) => topPad + index * laneGap;

  const sourceTrunks = new Map<string, number>();
  const targetTrunks = new Map<string, number>();
  segments.forEach((segment, index) => {
    const lane = laneOf(index);
    sourceTrunks.set(segment.from, Math.max(sourceTrunks.get(segment.from) ?? 0, lane));
    targetTrunks.set(
      segment.to,
      Math.min(targetTrunks.get(segment.to) ?? Number.POSITIVE_INFINITY, lane),
    );
  });

  const realTargets = Array.from(new Set(segments.map((segment) => segment.to))).filter((id) => {
    const item = toItems.find((candidate) => candidate.id === id);
    return item !== undefined && item.node !== null;
  });

  return (
    <div className="flow-connectors relative" style={{ height }} aria-hidden="true">
      {Array.from(sourceTrunks.entries()).map(([id, lane]) => (
        <span
          key={`source-${id}`}
          className="absolute w-px -translate-x-1/2 bg-muted-foreground/40"
          style={{ left: `${centerOf(fromItems, id)}%`, top: 0, height: lane }}
        />
      ))}

      {segments.map((segment, index) => {
        const fromX = centerOf(fromItems, segment.from);
        const toX = centerOf(toItems, segment.to);
        const lane = laneOf(index);
        return (
          <React.Fragment key={`edge-${index}`}>
            <span
              className="absolute h-px -translate-y-1/2 bg-muted-foreground/40"
              style={{
                left: `${Math.min(fromX, toX)}%`,
                width: `${Math.abs(toX - fromX)}%`,
                top: lane,
              }}
            />
            {segment.label && (
              <span
                className="flow-edge-label absolute -translate-x-1/2 -translate-y-1/2 max-w-[8rem] truncate rounded-[2px] border border-border bg-plate px-1.5 text-[0.65rem] leading-4 text-muted-foreground"
                style={{ left: `${(fromX + toX) / 2}%`, top: lane }}
                title={segment.label}
                data-label={segment.label}
                data-target={toItems.find((item) => item.id === segment.to)?.node?.label ?? ''}
              >
                {segment.label}
              </span>
            )}
          </React.Fragment>
        );
      })}

      {Array.from(targetTrunks.entries()).map(([id, lane]) => (
        <span
          key={`target-${id}`}
          className="absolute w-px -translate-x-1/2 bg-muted-foreground/40"
          style={{
            left: `${centerOf(toItems, id)}%`,
            top: lane,
            height: height - lane - (realTargets.includes(id) ? 10 : 0),
          }}
        />
      ))}

      {realTargets.map((id) => (
        <ArrowDown
          key={`arrow-${id}`}
          size={12}
          strokeWidth={2}
          className="absolute -translate-x-1/2 text-muted-foreground/70"
          style={{ left: `${centerOf(toItems, id)}%`, top: height - 12 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/** A single return link shown beneath the diagram; folds cycles and feedback. */
function FlowReturnRow({ edge, labels }: { edge: FlowEdgeSpec; labels: Map<string, string> }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[0.7rem] leading-snug text-muted-foreground">
      <CornerDownLeft size={12} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        <span className="font-medium text-foreground/75">{labels.get(edge.from) ?? edge.from}</span>
        {' returns to '}
        <span className="font-medium text-foreground/75">{labels.get(edge.to) ?? edge.to}</span>
        {edge.label ? ` · ${edge.label}` : ''}
      </span>
    </div>
  );
}

/**
 * Narrow-screen rules, scoped to the figure. They live here rather than in the
 * global sheet so the diagram is self-contained: below the breakpoint rows stop
 * being columns and become stacked cards, with branch labels listed above them.
 * This keeps every card inside the chat column instead of relying on a
 * horizontal scrollbar. Desktop rules are untouched.
 */
const FLOW_RESPONSIVE_CSS = `
.markdown-flow { container-type: inline-size; }
@container (max-width: 27rem) {
  .markdown-flow .flow-level {
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 0.375rem;
  }
  .markdown-flow .flow-item { padding-inline: 0; }
  .markdown-flow .flow-item:not(:has(.flow-card)) { display: none; }
  .markdown-flow .flow-card {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 0.625rem;
    padding: 0.625rem 0.75rem;
    text-align: left;
  }
  .markdown-flow .flow-card > svg { flex: none; }
  .markdown-flow .flow-card-text {
    align-items: flex-start;
    gap: 0.125rem;
    text-align: left;
  }
  .markdown-flow .flow-connectors {
    height: auto !important;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.375rem 0;
  }
  .markdown-flow .flow-connectors > span:not(.flow-edge-label),
  .markdown-flow .flow-connectors > svg { display: none; }
  .markdown-flow .flow-edge-label {
    position: static;
    transform: none;
    translate: none;
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
    font-size: 0.7rem;
    line-height: 1.35;
    padding: 0.0625rem 0.4rem;
  }
  .markdown-flow .flow-edge-label::after {
    content: ' → ' attr(data-target);
    color: var(--color-muted-foreground);
  }
  .markdown-flow .flow-connectors::after {
    content: '';
    width: 0;
    height: 0;
    margin-top: 0.125rem;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 5px solid var(--color-muted-foreground);
  }
}
`;

/**
 * Render a validated flow spec as a theme-aware diagram.
 *
 * Rows are equal-width columns on desktop and stack into full-width cards in a
 * narrow chat column, so no card is ever clipped by the bubble. Parse failures
 * are handled by the caller (MarkdownRenderer falls back to a normal code block).
 */
export function FlowBlock({ spec }: { spec: FlowSpec }) {
  const layout = layoutFlow(spec);
  const labels = new Map(spec.nodes.map((node) => [node.id, node.label]));

  const edgeSummary = spec.edges
    .map((edge) => {
      const from = labels.get(edge.from) ?? edge.from;
      const to = labels.get(edge.to) ?? edge.to;
      return `${from} to ${to}${edge.label ? `, ${edge.label}` : ''}`;
    })
    .join('; ');

  return (
    <figure
      role="group"
      aria-label={spec.title ?? spec.subtitle ?? 'Flow diagram'}
      className="markdown-flow my-3 w-full max-w-full rounded-[4px] border border-border bg-plate p-3 text-left sm:p-4"
    >
      <style>{FLOW_RESPONSIVE_CSS}</style>
      {(spec.title || spec.subtitle) && (
        <figcaption className="mb-3">
          {spec.title && (
            <div className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {spec.title}
            </div>
          )}
          {spec.subtitle && (
            <div className="mt-0.5 text-[0.72rem] leading-snug text-muted-foreground/80">
              {spec.subtitle}
            </div>
          )}
        </figcaption>
      )}

      <div>
        {layout.levels.map((level, levelIndex) => (
          <React.Fragment key={`level-${levelIndex}`}>
            {levelIndex > 0 && (
              layout.segments[levelIndex - 1]?.length ? (
                <FlowConnectors
                  segments={layout.segments[levelIndex - 1] ?? []}
                  fromItems={layout.levels[levelIndex - 1]}
                  toItems={level}
                />
              ) : (
                <div className="relative h-7" aria-hidden="true">
                  <ArrowDown
                    size={12}
                    strokeWidth={2}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/60"
                  />
                </div>
              )
            )}

            {layout.groups
              .filter((group) => group.level === levelIndex)
              .map((group, groupIndex) => (
                <div
                  key={`group-${levelIndex}-${groupIndex}`}
                  className="flow-group mb-1.5 mt-1 flex items-center gap-2 px-1"
                >
                  <span className="flow-group-caption min-w-0 break-words text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {group.label}
                  </span>
                  <span className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
                </div>
              ))}

            <div
              className="flow-level grid items-stretch"
              style={{ gridTemplateColumns: `repeat(${Math.max(level.length, 1)}, minmax(0, 1fr))` }}
            >
              {level.map((item) => (
                <div
                  key={item.id}
                  className={`flow-item flex min-w-0 items-stretch px-1.5 ${item.node ? 'py-0.5' : ''}`}
                >
                  {item.node ? (
                    <FlowNodeCard node={item.node} />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mx-auto w-px self-stretch bg-muted-foreground/25"
                    />
                  )}
                </div>
              ))}
            </div>
          </React.Fragment>
        ))}

        {layout.returns.length > 0 && (
          <div className="mt-3 flex min-w-0 flex-col gap-1 border-t border-border pt-2">
            {layout.returns.map((edge, index) => (
              <FlowReturnRow key={`return-${index}`} edge={edge} labels={labels} />
            ))}
          </div>
        )}
      </div>

      <p className="sr-only">{edgeSummary ? `Flow connections: ${edgeSummary}.` : 'Flow diagram.'}</p>
    </figure>
  );
}
