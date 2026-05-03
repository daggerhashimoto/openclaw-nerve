import { useState, useMemo, useCallback } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';
import { useSessionContext } from '@/contexts/SessionContext';
import { getSessionKey, type Session } from '@/types';
import { cn } from '@/lib/utils';
import { getSessionDisplayLabel } from '@/features/sessions/sessionKeys';

interface AddColumnDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddColumnDialog({ open, onClose }: AddColumnDialogProps) {
  const { columns, addColumn } = useDeck();
  const { sessions } = useSessionContext();
  const [search, setSearch] = useState('');

  const existingSessionKeys = useMemo(
    () => new Set(columns.map(c => c.sessionKey)),
    [columns],
  );

  const available = useMemo(() => {
    const filtered = sessions.filter(s => !existingSessionKeys.has(getSessionKey(s)));
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(s => {
      const key = getSessionKey(s).toLowerCase();
      const label = getSessionDisplayLabel(s, s.identityName).toLowerCase();
      return key.includes(q) || label.includes(q);
    });
  }, [sessions, existingSessionKeys, search]);

  const handleSelect = useCallback(
    (s: Session) => {
      addColumn(getSessionKey(s), s.identityName);
      onClose();
    },
    [addColumn, onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Session list */}
        <div className="max-h-64 overflow-y-auto">
          {available.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {sessions.length === 0
                ? 'No sessions available'
                : 'All sessions already in deck or no matches'}
            </div>
          )}
          {available.map(s => {
            const key = getSessionKey(s);
            const label = getSessionDisplayLabel(s, s.identityName);
            return (
              <button
                key={key}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent transition-colors',
                )}
                onClick={() => handleSelect(s)}
              >
                <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground truncate">{key}</div>
                </div>
                {s.identityName && (
                  <span className="text-xs text-muted-foreground shrink-0">{s.identityName}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}