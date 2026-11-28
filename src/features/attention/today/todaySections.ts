/**
 * Which Today sections are open, remembered per browser and per layout (desk or phone). Only a
 * section the operator toggled is stored; the rest follow the defaults: Chats open everywhere,
 * Done open at the desk and collapsed on phones. Storage that cannot be read or written leaves
 * the defaults in place.
 */

import { useState } from 'react';

export type TodaySection = 'chats' | 'done';
type Layout = 'desk' | 'phone';
type Stored = Partial<Record<Layout, Partial<Record<TodaySection, boolean>>>>;

export const TODAY_SECTIONS_KEY = 'nerve:attention:today:sections';

export function defaultSections(compact: boolean): Record<TodaySection, boolean> {
  return { chats: true, done: !compact };
}

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(TODAY_SECTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' ? parsed as Stored : {};
  } catch {
    return {};
  }
}

export function readSections(compact: boolean): Record<TodaySection, boolean> {
  const stored = readStored()[compact ? 'phone' : 'desk'] ?? {};
  const defaults = defaultSections(compact);
  return {
    chats: typeof stored.chats === 'boolean' ? stored.chats : defaults.chats,
    done: typeof stored.done === 'boolean' ? stored.done : defaults.done,
  };
}

export function writeSection(compact: boolean, section: TodaySection, open: boolean): void {
  try {
    const stored = readStored();
    const layout = compact ? 'phone' : 'desk';
    stored[layout] = { ...stored[layout], [section]: open };
    localStorage.setItem(TODAY_SECTIONS_KEY, JSON.stringify(stored));
  } catch {
    // Not remembered; the section still opens or closes.
  }
}

/** Open sections for the current layout; `set` remembers the operator's choice. */
export function useTodaySections(compact: boolean) {
  const [state, setState] = useState(() => ({ compact, open: readSections(compact) }));
  // A layout change (desk to phone) reads that layout's own choice.
  const current = state.compact === compact ? state.open : readSections(compact);
  if (state.compact !== compact) setState({ compact, open: current });

  const set = (section: TodaySection, open: boolean) => {
    writeSection(compact, section, open);
    // Functional, so two sections set in one handler both stick.
    setState((prev) => {
      const base = prev.compact === compact ? prev.open : readSections(compact);
      return { compact, open: { ...base, [section]: open } };
    });
  };
  return { open: current, set, toggle: (section: TodaySection) => set(section, !current[section]) };
}
