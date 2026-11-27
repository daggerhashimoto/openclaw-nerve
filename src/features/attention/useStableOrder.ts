import { useMemo, useState } from 'react';
import type { AttentionItem } from './types';

interface OrderState {
  epoch: number;
  /** Item keys in the order the operator first saw them, later arrivals appended. */
  order: string[];
  /** Keys present when the epoch began; every other key in `order` arrived later. */
  baseline: ReadonlySet<string>;
}

export interface StableOrder {
  items: AttentionItem[];
  newKeys: ReadonlySet<string>;
}

const keysOf = (items: AttentionItem[]): string[] => items.map((item) => item.key);

function startEpoch(items: AttentionItem[], epoch: number): OrderState {
  const order = keysOf(items);
  return { epoch, order, baseline: new Set(order) };
}

/**
 * Keeps cards where the operator first saw them while a brief is open, so a poll refresh never
 * moves a card under the pointer. Items that arrive later are appended in ranked order and
 * reported in `newKeys`; items that leave the input are dropped. A new `epoch` (the view being
 * opened again, or an explicit refresh) takes the incoming ranked order as the new baseline.
 */
export function useStableOrder(items: AttentionItem[], epoch: number): StableOrder {
  const [state, setState] = useState<OrderState>(() => startEpoch(items, epoch));

  // Derived state is adjusted during render, not in an effect, so a render never shows an order
  // that is one commit behind. React re-runs the render at once when state is set here.
  let current = state;
  if (state.epoch !== epoch) {
    current = startEpoch(items, epoch);
  } else {
    const known = new Set(state.order);
    const arrived = keysOf(items).filter((key) => !known.has(key));
    if (arrived.length > 0) current = { ...state, order: [...state.order, ...arrived] };
  }
  if (current !== state) setState(current);

  return useMemo(() => {
    const byKey = new Map(items.map((item) => [item.key, item] as const));
    const ordered: AttentionItem[] = [];
    const newKeys = new Set<string>();
    for (const key of current.order) {
      const item = byKey.get(key);
      if (!item) continue;
      ordered.push(item);
      if (!current.baseline.has(key)) newKeys.add(key);
    }
    return { items: ordered, newKeys };
  }, [items, current]);
}
