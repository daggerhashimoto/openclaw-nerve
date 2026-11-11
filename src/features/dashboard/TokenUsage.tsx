import { useState, useMemo, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TokenData, TokenEntry } from '@/types';
import { Pane } from '@/components/ui/Pane';
import { fmtTokens } from '@/lib/formatting';
import { useLimits } from './useLimits';
import type { CodexLimits, ClaudeCodeLimits } from './useLimits';
import { LIMIT_CRITICAL_PERCENT, LIMIT_WARNING_PERCENT, fmtDollars, providerName } from './usageWords';

// ── Times ────────────────────────────────────────────────────────────

function formatResetTime(tsMs: number, opts: { withDate?: boolean } = {}): string {
  const d = new Date(tsMs);
  if (opts.withDate) {
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTimeAgo(tsMs: number): string {
  const seconds = Math.floor((Date.now() - tsMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Re-render periodically so "checked 3m ago" stays honest while the panel is open. */
function useTick(intervalMs: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

// ── Meter ────────────────────────────────────────────────────────────

/**
 * A thin track with a fill, the status bar's context meter idiom. Neutral by
 * default; a limit nearing exhaustion warms to Cantaloupe (the operator should
 * act) and turns Signal Red when it is about to bite. The readout says the same.
 */
function Meter({ percent, label, warn = false }: { percent: number; label: string; warn?: boolean }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const critical = warn && clamped >= LIMIT_CRITICAL_PERCENT;
  const warning = warn && !critical && clamped >= LIMIT_WARNING_PERCENT;
  const fill = critical ? 'bg-destructive' : warning ? 'bg-operator' : 'bg-muted-foreground';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="h-[2px] min-w-0 flex-1 overflow-hidden rounded-[1px] bg-border"
    >
      <div className={`h-full transition-[width,background-color] duration-[120ms] ${fill}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function readoutClass(percent: number): string {
  if (percent >= LIMIT_CRITICAL_PERCENT) return 'text-destructive';
  if (percent >= LIMIT_WARNING_PERCENT) return 'text-operator-text';
  return 'text-foreground';
}

// ── Rate limits ──────────────────────────────────────────────────────

interface LimitRowProps {
  label: string;
  usedPercent: number;
  resetText?: string;
}

function LimitRow({ label, usedPercent, resetText }: LimitRowProps) {
  return (
    <div className="grid grid-cols-[6.4rem_1fr_auto] items-center gap-3 py-1 text-[0.8rem]">
      <span className="text-muted-foreground">{label}</span>
      <Meter percent={usedPercent} label={`${label} used`} warn />
      <span className="font-mono tabular text-right">
        <span className={readoutClass(usedPercent)}>{Math.round(usedPercent)}% used</span>
        {resetText && <span className="text-muted-foreground">, resets {resetText}</span>}
      </span>
    </div>
  );
}

interface LimitsSectionProps {
  lastChecked: number | null;
  loading: boolean;
  unavailable: boolean;
  children?: React.ReactNode;
}

/** The rate limits of one provider: a heading row, then one meter row per window. */
function LimitsSection({ lastChecked, loading, unavailable, children }: LimitsSectionProps) {
  useTick(10_000);

  return (
    <div className="mt-1 border-t border-border pt-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.8rem]">
        <span className="font-medium text-foreground">Rate limits</span>
        {loading ? (
          <span className="text-muted-foreground">Checking</span>
        ) : unavailable ? (
          <span className="text-muted-foreground">Unavailable</span>
        ) : lastChecked ? (
          <span className="font-mono tabular text-muted-foreground">checked {formatTimeAgo(lastChecked)}</span>
        ) : null}
      </div>
      {!loading && !unavailable && children}
    </div>
  );
}

function CodexLimitsSection({ limits, lastChecked }: { limits: CodexLimits | null; lastChecked: number | null }) {
  const five = limits?.five_hour_limit;
  const week = limits?.weekly_limit;
  return (
    <LimitsSection lastChecked={lastChecked} loading={limits === null} unavailable={!limits?.available || !five}>
      {five && (
        <LimitRow
          label="5 hour window"
          usedPercent={five.used_percent}
          resetText={typeof five.resets_at === 'number' ? formatResetTime(five.resets_at * 1000) : undefined}
        />
      )}
      {week && (
        <LimitRow
          label="Weekly"
          usedPercent={week.used_percent}
          resetText={typeof week.resets_at === 'number' ? formatResetTime(week.resets_at * 1000, { withDate: true }) : undefined}
        />
      )}
    </LimitsSection>
  );
}

function ClaudeLimitsSection({ limits, lastChecked }: { limits: ClaudeCodeLimits | null; lastChecked: number | null }) {
  const session = limits?.session_limit;
  const week = limits?.weekly_limit;
  const sessionReset = session?.resets_at_epoch
    ? formatResetTime(session.resets_at_epoch)
    : session?.resets_at_raw?.replace(/\s*\(UTC\)\s*/g, '').trim();
  const weekReset = week?.resets_at_epoch
    ? formatResetTime(week.resets_at_epoch, { withDate: true })
    : week?.resets_at_raw?.replace(/\s*\(UTC\)\s*/g, '').trim();
  return (
    <LimitsSection lastChecked={lastChecked} loading={limits === null} unavailable={!limits?.available || !session}>
      {session && <LimitRow label="Session" usedPercent={session.used_percent} resetText={sessionReset || undefined} />}
      {week && <LimitRow label="Weekly" usedPercent={week.used_percent} resetText={weekReset || undefined} />}
    </LimitsSection>
  );
}

// ── Provider row ─────────────────────────────────────────────────────

interface ProviderRowProps {
  entry: TokenEntry;
  /** Spend across the listed providers, for the share meter; undefined hides the meter (one provider has no share). */
  spendTotal?: number;
  codexLimits: CodexLimits | null;
  claudeLimits: ClaudeCodeLimits | null;
  codexLastChecked: number | null;
  claudeLastChecked: number | null;
}

/** A detail line: label in Slate, value in mono. */
function Detail({ label, value, tone }: { label: string; value: string; tone?: 'error' }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`m-0 font-mono tabular ${tone === 'error' ? 'text-destructive' : 'text-foreground'}`}>{value}</dd>
    </>
  );
}

function ProviderRow({ entry, spendTotal, codexLimits, claudeLimits, codexLastChecked, claudeLastChecked }: ProviderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const name = providerName(entry.source);
  const errors = entry.errorCount || 0;
  const messages = entry.messageCount || 0;
  const perMessage = messages ? entry.cost / messages : 0;
  const hasLimits = entry.source === 'openai-codex' || entry.source === 'anthropic';

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-label={`${name}, ${fmtDollars(entry.cost)}${errors > 0 ? `, ${errors} errors` : ''}`}
        className="group flex min-h-[var(--row-unit)] w-full cursor-pointer items-center gap-2 rounded-[2px] border-0 bg-transparent px-3 text-left transition-colors duration-[120ms] hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-muted-foreground transition-transform duration-[120ms] ${expanded ? 'rotate-90' : ''}`}
        />
        {errors > 0 && <Pane state="error" size="sm" label={`${errors} errors`} />}
        <span className="min-w-0 truncate text-[0.867rem] text-foreground">{name}</span>
        {spendTotal !== undefined && (
          <Meter percent={(entry.cost / spendTotal) * 100} label={`${name} share of spend`} />
        )}
        <span className="ml-auto shrink-0 font-mono text-[0.867rem] tabular text-foreground">{fmtDollars(entry.cost)}</span>
      </button>

      {expanded && (
        <div className="pb-2 pl-[2.133rem] pr-3">
          <dl className="m-0 grid grid-cols-[6.4rem_1fr] gap-x-3 gap-y-0.5 text-[0.8rem]">
            <Detail label="Input" value={`${fmtTokens(entry.inputTokens || 0)} tokens`} />
            <Detail label="Output" value={`${fmtTokens(entry.outputTokens || 0)} tokens`} />
            {(entry.cacheReadTokens || 0) > 0 && (
              <Detail label="Cached" value={`${fmtTokens(entry.cacheReadTokens || 0)} tokens`} />
            )}
            <Detail label="Messages" value={messages.toLocaleString('en-US')} />
            {messages > 0 && <Detail label="Per message" value={fmtDollars(perMessage, 4)} />}
            {errors > 0 && <Detail label="Errors" value={errors.toLocaleString('en-US')} tone="error" />}
          </dl>
          {hasLimits && entry.source === 'openai-codex' && (
            <CodexLimitsSection limits={codexLimits} lastChecked={codexLastChecked} />
          )}
          {hasLimits && entry.source === 'anthropic' && (
            <ClaudeLimitsSection limits={claudeLimits} lastChecked={claudeLastChecked} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────

interface TokenUsageProps {
  data: TokenData | null;
}

/**
 * The usage panel: what the fleet has spent, by provider, with each
 * provider's token counts and rate limits one click away. Sentence case,
 * numbers in mono, no decoration.
 */
export function TokenUsage({ data }: TokenUsageProps) {
  const entries = useMemo(
    () => (data?.entries || []).filter((e) => e.cost > 0 || (e.messageCount || 0) > 0 || (e.errorCount || 0) > 0),
    [data?.entries],
  );
  const spendTotal = useMemo(() => entries.reduce((sum, e) => sum + e.cost, 0), [entries]);
  const { codexLimits, claudeLimits, codexLastChecked, claudeLastChecked } = useLimits();

  const totalCost = data?.persistent?.totalCost ?? data?.totalCost ?? 0;
  const totalInput = data?.persistent?.totalInput || data?.totalInput || 0;
  const totalOutput = data?.persistent?.totalOutput || data?.totalOutput || 0;
  const totalMessages = data?.totalMessages ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-header pr-3">
        <span className="panel-label">Usage</span>
        {data && (
          <span className="ml-auto text-[0.867rem]">
            <span className="font-mono tabular text-foreground">{fmtDollars(totalCost)}</span>
            <span className="text-muted-foreground"> all time</span>
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!data ? (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">Loading usage</div>
        ) : entries.length === 0 ? (
          <div className="flex min-h-[var(--row-unit)] items-center px-3 text-[0.8rem] text-muted-foreground">No usage recorded yet.</div>
        ) : (
          <div className="py-1">
            {entries.map((entry) => (
              <ProviderRow
                key={entry.source}
                entry={entry}
                spendTotal={entries.length > 1 && spendTotal > 0 ? spendTotal : undefined}
                codexLimits={codexLimits}
                claudeLimits={claudeLimits}
                codexLastChecked={codexLastChecked}
                claudeLastChecked={claudeLastChecked}
              />
            ))}
          </div>
        )}
      </div>

      {data && entries.length > 0 && (
        <div className="flex min-h-[var(--row-unit)] shrink-0 items-center gap-x-3 overflow-hidden whitespace-nowrap border-t border-border px-3 font-mono text-[0.8rem] tabular text-muted-foreground">
          <span><span className="text-foreground">{fmtTokens(totalInput)}</span> in</span>
          <span><span className="text-foreground">{fmtTokens(totalOutput)}</span> out</span>
          {totalMessages > 0 && (
            <span><span className="text-foreground">{totalMessages.toLocaleString('en-US')}</span> messages</span>
          )}
        </div>
      )}
    </div>
  );
}
