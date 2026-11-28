/**
 * What the board's keys do to one item. Rows, the Start here plate and agent lines answer the
 * same commands; a command the item has no action for does nothing.
 */

import type { AgentLine } from './buildAgents';
import type { ItemCommand } from './triage';
import type { ActionId, ItemActionsState } from './useAttentionActions';

const REJECTS: ActionId[] = ['reject-proposal', 'deny'];

export interface CommandTarget {
  state: ItemActionsState;
  /** The item is open in full (an open row; the plate always is). */
  open: boolean;
  /** Opens or closes a row in place. Absent on the plate and agent lines. */
  toggle?: () => void;
  /** Opens the item's source, when it has one. */
  openSource?: () => void;
  markSeen?: () => void;
  reply?: { enabled: boolean; openField: () => void };
  /** Allow waits until the whole command shows: the first a opens the row instead. */
  hidePrimary?: boolean;
}

export function runItemCommand(command: ItemCommand, target: CommandTarget): boolean {
  const { state, open, toggle } = target;
  const { primary, secondary, more = [] } = state.actions;
  const all = [primary, secondary, ...more].filter((action): action is ActionId => action !== null);
  // The note and the reply field live in the open row, so a collapsed row opens first.
  const openFirst = () => {
    if (!open) toggle?.();
  };
  switch (command) {
    case 'toggle':
      if (!toggle) return false;
      toggle();
      return true;
    case 'open':
      if (!target.openSource) return false;
      target.openSource();
      return true;
    case 'seen':
      if (!target.markSeen) return false;
      target.markSeen();
      return true;
    case 'reply':
      if (!target.reply?.enabled) return false;
      openFirst();
      target.reply.openField();
      return true;
    case 'primary': {
      if (!primary || primary === 'stop') return false;
      if (target.hidePrimary && !open) {
        toggle?.();
        return true;
      }
      if (state.isLocked(primary)) return false;
      state.begin(primary);
      return true;
    }
    case 'reject': {
      const action = all.find((candidate) => REJECTS.includes(candidate));
      if (!action || state.isLocked(action)) return false;
      state.begin(action);
      return true;
    }
    case 'changes':
      if (!all.includes('request-changes') || state.isLocked('request-changes')) return false;
      openFirst();
      state.begin('request-changes');
      return true;
    case 'pause':
      if (!all.includes('pause-cron') || state.isLocked('pause-cron')) return false;
      state.begin('pause-cron');
      return true;
    case 'stop':
      if (!all.includes('stop') || state.isLocked('stop')) return false;
      // The second s confirms.
      if (state.confirming) void state.run('stop');
      else state.begin('stop');
      return true;
  }
}

/** The key an agent line answers the board's keys under. */
export function agentNavKey(line: Pick<AgentLine, 'agentId' | 'name'>): string {
  return `agent:${line.agentId ?? line.name}`;
}
