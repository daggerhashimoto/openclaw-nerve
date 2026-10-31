import { Pane } from '@/components/ui/Pane';
import { paneStateLabel, type PaneState } from '@/lib/paneState';

/** One window of the facade: a session, its light, and its display name. */
export interface FacadeWindow {
  key: string;
  state: PaneState;
  label: string;
  /** Identity hue of the session's agent family (already shaded for depth). */
  hue?: string;
}

interface SessionFacadeProps {
  /** Windows in the same order as the rows below the facade. */
  windows: FacadeWindow[];
  /** The open session: its window gets a sill. */
  currentSession: string;
  /** Clicking a window opens that session. */
  onSelect: (key: string) => void;
}

/**
 * The agents column's facade: every session is one window of a building seen
 * at night. Blue windows are agents at work, cantaloupe ones hold an answer
 * waiting on you, dark ones are quiet. The group names the counts for
 * assistive tech; each window names its session and state.
 */
export function SessionFacade({ windows, currentSession, onSelect }: SessionFacadeProps) {
  if (windows.length === 0) return null;

  const running = windows.filter((window) => window.state === 'live').length;
  const waiting = windows.filter((window) => window.state === 'operator').length;
  const summary = [
    `${windows.length} ${windows.length === 1 ? 'session' : 'sessions'}`,
    running > 0 ? `${running} running` : null,
    waiting > 0 ? `${waiting} waiting on you` : null,
  ].filter(Boolean).join(', ');

  return (
    <div className="facade" role="group" aria-label={summary} title={summary}>
      {windows.map((window) => {
        const current = window.key === currentSession;
        const name = `${window.label}: ${paneStateLabel(window.state)}`;
        return (
          <button
            key={window.key}
            type="button"
            className="facade-window"
            data-state={window.state}
            data-current={current ? 'true' : undefined}
            aria-current={current ? 'true' : undefined}
            title={name}
            aria-label={name}
            onClick={() => onSelect(window.key)}
          >
            <Pane state={window.state} size="lg" hue={window.hue} />
          </button>
        );
      })}
    </div>
  );
}
