/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useState, useEffect, useMemo, useRef, type ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────

export type LayoutMode = 'single' | 'deck';

export interface DeckColumn {
  id: string;
  sessionKey: string;
  agentId?: string;
  /** Flex proportion (default 1 = equal share). Manual resize sets custom proportions. */
  flex: number;
}

// ── Persistence ──────────────────────────────────────────────────────────

const LAYOUT_MODE_KEY = 'nerve:layout-mode';
const DECK_COLUMNS_KEY = 'nerve:deck-columns';

const MIN_COLUMN_FLEX = 0.3; // minimum flex proportion (~30% of average)

function loadLayoutMode(): LayoutMode {
  const saved = localStorage.getItem(LAYOUT_MODE_KEY);
  if (saved === 'single' || saved === 'deck') return saved;
  return 'single';
}

function saveLayoutMode(mode: LayoutMode): void {
  localStorage.setItem(LAYOUT_MODE_KEY, mode);
}

function loadColumns(): DeckColumn[] {
  try {
    const raw = localStorage.getItem(DECK_COLUMNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: unknown) =>
        typeof c === 'object' && c !== null &&
        typeof (c as DeckColumn).id === 'string' &&
        typeof (c as DeckColumn).sessionKey === 'string'
    ).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      sessionKey: c.sessionKey as string,
      agentId: c.agentId as string | undefined,
      flex: typeof c.flex === 'number' ? c.flex : 1,
    }));
  } catch {
    return [];
  }
}

function saveColumns(columns: DeckColumn[]): void {
  localStorage.setItem(DECK_COLUMNS_KEY, JSON.stringify(columns));
}

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function generateColumnId(): string {
  return `col-${Date.now()}-${++_idCounter}`;
}

/** Reset all columns to equal flex proportions */
function equalizeFlex(columns: DeckColumn[]): DeckColumn[] {
  if (columns.length === 0) return columns;
  return columns.map(c => ({ ...c, flex: 1 }));
}

// ── Context ──────────────────────────────────────────────────────────────

interface DeckContextValue {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  columns: DeckColumn[];
  activeColumnId: string | null;
  setActiveColumn: (id: string) => void;
  addColumn: (sessionKey: string, agentId?: string) => void;
  removeColumn: (id: string) => void;
  reorderColumns: (fromIdx: number, toIdx: number) => void;
  /** Resize by adjusting flex proportions of two adjacent columns */
  resizeColumn: (leftId: string, rightId: string, deltaRatio: number) => void;
  /** Auto-add a column if transitioning to deck with none */
  ensureColumn: (sessionKey: string, agentId?: string) => void;
  /** Equalize all columns to equal width */
  equalizeColumns: () => void;
}

const DeckContext = createContext<DeckContextValue | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const [layoutMode, setLayoutModeRaw] = useState<LayoutMode>(loadLayoutMode);
  const [columns, setColumns] = useState<DeckColumn[]>(loadColumns);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);

  // Persist on change
  useEffect(() => { saveLayoutMode(layoutMode); }, [layoutMode]);
  useEffect(() => { saveColumns(columns); }, [columns]);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeRaw(mode);
  }, []);

  const addColumn = useCallback((sessionKey: string, agentId?: string) => {
    const id = generateColumnId();
    setColumns(prev => {
      if (prev.some(c => c.sessionKey === sessionKey)) return prev;
      const newCol: DeckColumn = { id, sessionKey, agentId, flex: 1 };
      return equalizeFlex([...prev, newCol]);
    });
    setActiveColumnId(id);
  }, []);

  const removeColumn = useCallback((id: string) => {
    setColumns(prev => {
      const next = prev.filter(c => c.id !== id);
      return equalizeFlex(next);
    });
    setActiveColumnId(prev => prev === id ? null : prev);
  }, []);

  const reorderColumns = useCallback((fromIdx: number, toIdx: number) => {
    setColumns(prev => {
      if (fromIdx < 0 || fromIdx >= prev.length || toIdx < 0 || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  /** Resize by transferring flex proportion between two adjacent columns.
   *  deltaRatio > 0 means left column grows, right shrinks. */
  const resizeColumn = useCallback((leftId: string, rightId: string, deltaRatio: number) => {
    setColumns(prev => {
      const left = prev.find(c => c.id === leftId);
      const right = prev.find(c => c.id === rightId);
      if (!left || !right) return prev;

      const totalFlex = left.flex + right.flex;
      let newLeftFlex = left.flex + deltaRatio;
      let newRightFlex = right.flex - deltaRatio;

      // Enforce minimum flex on both sides
      const minFlex = MIN_COLUMN_FLEX;
      if (newLeftFlex < minFlex) {
        newLeftFlex = minFlex;
        newRightFlex = totalFlex - minFlex;
      }
      if (newRightFlex < minFlex) {
        newRightFlex = minFlex;
        newLeftFlex = totalFlex - minFlex;
      }

      return prev.map(c => {
        if (c.id === leftId) return { ...c, flex: newLeftFlex };
        if (c.id === rightId) return { ...c, flex: newRightFlex };
        return c;
      });
    });
  }, []);

  const ensureColumn = useCallback((sessionKey: string, agentId?: string) => {
    setColumns(prev => {
      if (prev.length > 0) return prev;
      const id = generateColumnId();
      const newCol: DeckColumn = { id, sessionKey, agentId, flex: 1 };
      setActiveColumnId(id);
      return [newCol];
    });
  }, []);

  const equalizeColumns = useCallback(() => {
    setColumns(prev => equalizeFlex(prev));
  }, []);

  // Auto-set active to first column if none selected
  useEffect(() => {
    if (!activeColumnId && columns.length > 0) {
      setActiveColumnId(columns[0].id);
    }
  }, [activeColumnId, columns]);

  const setActiveColumn = useCallback((id: string) => {
    setActiveColumnId(id);
  }, []);

  const value = useMemo<DeckContextValue>(() => ({
    layoutMode,
    setLayoutMode,
    columns,
    activeColumnId,
    setActiveColumn,
    addColumn,
    removeColumn,
    reorderColumns,
    resizeColumn,
    ensureColumn,
    equalizeColumns,
  }), [
    layoutMode, setLayoutMode, columns, activeColumnId, setActiveColumn,
    addColumn, removeColumn, reorderColumns, resizeColumn, ensureColumn, equalizeColumns,
  ]);

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckContextValue {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error('useDeck must be used inside <DeckProvider>');
  return ctx;
}