import { fmtK } from '@/lib/formatting';
import { CONTEXT_WARNING_THRESHOLD, CONTEXT_CRITICAL_THRESHOLD } from '@/lib/constants';

/** Props for {@link ContextMeter}. */
interface ContextMeterProps {
  /** Number of context tokens consumed so far. */
  used: number;
  /** Maximum context window size in tokens. */
  limit: number;
}

/**
 * Compact context-window meter for the {@link StatusBar}.
 *
 * A thin neutral track with a foreground fill and a "61% of 200k" readout.
 * The fill turns to the operator colour once the window nears its limit (the
 * operator should act) and to destructive when it is nearly full. The readout
 * and tooltip carry the same state in words, so colour is never the only signal.
 */
export function ContextMeter({ used, limit }: ContextMeterProps) {
  const percent = Math.min(100, (used / limit) * 100);
  const roundedPercent = Math.round(percent);

  const isWarning = percent >= CONTEXT_WARNING_THRESHOLD;
  const isCritical = percent >= CONTEXT_CRITICAL_THRESHOLD;

  const fillClass = isCritical ? 'bg-destructive' : isWarning ? 'bg-operator' : 'bg-foreground';
  const readoutClass = isCritical
    ? 'text-destructive'
    : isWarning
    ? 'text-operator-text'
    : 'text-muted-foreground';

  const tooltipText = `Context: ${fmtK(used)} of ${fmtK(limit)} tokens (${percent.toFixed(0)}%)${
    isCritical
      ? '. Nearly full, consider starting a new session'
      : isWarning
      ? '. Approaching the context limit'
      : ''
  }`;

  return (
    <div
      className="flex cursor-default items-center gap-2"
      title={tooltipText}
    >
      <span className="text-muted-foreground max-[480px]:sr-only">Context</span>

      <div className="h-[2px] w-[4.8rem] shrink-0 overflow-hidden rounded-[1px] bg-border max-[480px]:w-10">
        <div
          className={`h-full transition-[width,background-color] duration-[120ms] ${fillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <span className={`font-mono tabular ${readoutClass}`}>
        {roundedPercent}% of {fmtK(limit)}
      </span>
    </div>
  );
}
