/* eslint-disable react-refresh/only-export-components -- hook intentionally co-located with provider */
import { createContext, useContext, useCallback, useState, useEffect, useMemo, type ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────

export type LayoutMode = 'single' | 'deck';

export interface DeckColumn {
  id: string;
  sessionKey: string;
  agentId?: string;
  width: number; // px
}

// ── Persistence ──────────────────────────────────────────────────────────

const LAYOUT_MODE_KEY = 'nerve:layout-mode';
const DECK_COLUMNS_KEY = 'nerve:deck-columns';

const MIN_COLUMN_WIDTH = 280;

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
        typeof (c as DeckColumn).sessionKey === 'string' &&
        typeof (c as DeckColumn).width === 'number'
    );
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

function redistributeWidth(columns: DeckColumn[], totalWidth: number): DeckColumn[] {
  if (columns.length === 0) return columns;
  const equalWidth = Math.max(MIN_COLUMN_WIDTH, totalWidth / columns.length);
  return columns.map(c => ({ ...c, width: equalWidth }));
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
  resizeColumn: (id: string, newWidth: number) => void;
  /** Auto-add a column if transitioning to deck with none */
  ensureColumn: (sessionKey: string, agentId?: string) => void;
  minColumnWidth: number;
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
      const newCol: DeckColumn = { id, sessionKey, agentId, width: 0 };
      const next = [...prev, newCol];
      return redistributeWidth(next, 1200);
    });
    setActiveColumnId(id);
  }, []);

  const removeColumn = useCallback((id: string) => {
    setColumns(prev => {
      const next = prev.filter(c => c.id !== id);
      return redistributeWidth(next, 1200);
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

  const resizeColumn = useCallback((id: string, newWidth: number) => {
    setColumns(prev =>
      prev.map(c => c.id === id ? { ...c, width: Math.max(MIN_COLUMN_WIDTH, newWidth) } : c)
    );
  }, []);

  const ensureColumn = useCallback((sessionKey: string, agentId?: string) => {
    setColumns(prev => {
      if (prev.length > 0) return prev;
      const id = generateColumnId();
      const newCol: DeckColumn = { id, sessionKey, agentId, width: 1200 };
      setActiveColumnId(id);
      return [newCol];
    });
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
    minColumnWidth: MIN_COLUMN_WIDTH,
  }), [
    layoutMode, setLayoutMode, columns, activeColumnId, setActiveColumn,
    addColumn, removeColumn, reorderColumns, resizeColumn, ensureColumn,
  ]);

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckContextValue {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error('useDeck must be used inside <DeckProvider>');
  return ctx;
}