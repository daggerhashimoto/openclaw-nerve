/**
 * The board's keys in one small panel, opened with ? (or the keycap on the heading row).
 */

import { cn } from '@/lib/utils';
import { variantClass } from './actionStyles';

/** `then` marks a sequence (g then n); other key pairs are alternatives. */
const SHORTCUTS: Array<{ keys: string[]; label: string; then?: boolean }> = [
  { keys: ['j', 'k'], label: 'Next or previous item' },
  { keys: ['Enter'], label: 'Open or close the item' },
  { keys: ['a'], label: 'Approve, allow, retry or run' },
  { keys: ['x'], label: 'Reject or deny' },
  { keys: ['c'], label: 'Request changes' },
  { keys: ['r'], label: 'Reply' },
  { keys: ['s'], label: 'Stop (s again to confirm)' },
  { keys: ['p'], label: 'Pause a cron' },
  { keys: ['e'], label: 'Mark seen' },
  { keys: ['o'], label: 'Open the source' },
  { keys: ['u'], label: 'Undo the last action' },
  { keys: ['n'], label: 'Show new items' },
  { keys: ['g', 'n'], label: 'Go to Now', then: true },
  { keys: ['g', 't'], label: 'Go to Today', then: true },
  { keys: ['/'], label: 'Ask the agent' },
  { keys: ['?'], label: 'Show or hide these keys' },
];

export function ShortcutsPanel({ compact, onClose }: { compact: boolean; onClose: () => void }) {
  return (
    <section
      aria-labelledby="attention-shortcuts"
      data-testid="attention-shortcuts"
      className={cn('plate flex min-w-0 flex-col gap-2 px-3 py-2.5', compact ? 'mx-4' : 'max-w-[34rem]')}
    >
      <div className="flex items-center gap-2">
        <h2 id="attention-shortcuts" className="m-0 text-[0.867rem] font-semibold text-foreground">Keyboard</h2>
        <span className="text-[0.8rem] text-muted-foreground">Off while you type</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className={cn(variantClass('text', compact), 'text-[0.8rem]')}>
          Close
        </button>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-[0.8rem] sm:grid-cols-[auto_1fr_auto_1fr]">
        {SHORTCUTS.map(({ keys, label, then }) => (
          <div key={label} className="contents">
            <dt className="flex items-center gap-1">
              {keys.map((key, index) => (
                <span key={key} className="inline-flex items-center gap-1">
                  {index > 0 && then && <span className="text-muted-foreground">then</span>}
                  <kbd className="cockpit-kbd">{key}</kbd>
                </span>
              ))}
            </dt>
            <dd className="m-0 text-muted-foreground">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
