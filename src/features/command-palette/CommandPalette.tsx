import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Command as CommandIcon, Search } from 'lucide-react';
import { Dialog, DialogPortal } from '@/components/ui/dialog';
import { filterCommands } from './commands';
import type { Command } from './types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

const CATEGORY_LABELS: Record<string, string> = {
  actions: 'Actions',
  navigation: 'Navigation',
  settings: 'Settings',
  appearance: 'Appearance',
  voice: 'Voice',
};

/** Cmd+K command palette overlay with fuzzy search. */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [usingKeyboard, setUsingKeyboard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Reset state and focus when opened
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on open transition
      setQuery('');
      setSelectedIndex(0);
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector('[data-selected="true"]') as HTMLElement;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const executeCommand = useCallback((cmd: Command) => {
    onClose();
    // Small delay to let dialog close animation start
    setTimeout(() => cmd.action(), 50);
  }, [onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setUsingKeyboard(true);
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setUsingKeyboard(true);
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) {
          executeCommand(filtered[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [filtered, selectedIndex, executeCommand, onClose]);

  // Only update selection on mouse move if the mouse actually moved (not just keyboard scroll)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    if (lastMousePos.current.x === clientX && lastMousePos.current.y === clientY) return;
    lastMousePos.current = { x: clientX, y: clientY };
    setUsingKeyboard(false);
  }, []);

  // Group commands by category with flat index mapping
  const { groupedCommands, flatIndexMap } = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    const indexMap = new Map<string, number>();
    let idx = 0;
    for (const cmd of filtered) {
      const cat = cmd.category || 'actions';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(cmd);
      indexMap.set(cmd.id, idx++);
    }
    return { groupedCommands: groups, flatIndexMap: indexMap };
  }, [filtered]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()} modal={false}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-black/38 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] pointer-events-none">
          <div 
            className="cockpit-command-shell pointer-events-auto w-full max-w-[38rem] animate-in fade-in-0 zoom-in-95 duration-150"
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="border-b border-border/60 bg-secondary/42 px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="cockpit-kicker">
                    <CommandIcon size={14} className="text-primary" />
                    Command Palette
                  </div>
                  <p className="text-sm text-muted-foreground">Jump to actions, views, and cockpit toggles.</p>
                </div>
                <kbd className="cockpit-kbd hidden sm:inline-flex">esc</kbd>
              </div>
              <div className="cockpit-row p-0 pr-2">
                <Search size={16} className="ml-4 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  placeholder="Search actions, panels, and settings"
                  className="h-12 flex-1 bg-transparent text-[1rem] text-foreground outline-none placeholder:text-muted-foreground"
                />
                <span className="hidden text-[0.733rem] text-muted-foreground sm:inline">Enter to run</span>
              </div>
            </div>

            {/* Command list */}
            <div ref={listRef} className="max-h-[360px] overflow-y-auto overscroll-contain py-2" onMouseMove={handleMouseMove}>
              {filtered.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <div className="cockpit-badge mx-auto w-fit" data-tone="primary">
                    <Search size={12} />
                    No matching command
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Try a broader term like <span className="cockpit-code">settings</span> or <span className="cockpit-code">workspace</span>.
                  </p>
                </div>
              ) : (
                Object.entries(groupedCommands).map(([category, cmds]) => (
                  <div key={category}>
                    <div className="cockpit-command-section">
                      {CATEGORY_LABELS[category] || category}
                    </div>
                    {cmds.map((cmd) => {
                      const idx = flatIndexMap.get(cmd.id) ?? -1;
                      const isSelected = idx === selectedIndex;
                      return (
                        <button
                          key={cmd.id}
                          data-selected={isSelected}
                          onClick={() => executeCommand(cmd)}
                          onMouseEnter={() => { if (!usingKeyboard) setSelectedIndex(idx); }}
                          data-active={isSelected}
                          className="cockpit-command-item"
                        >
                          {cmd.icon || <CommandIcon size={15} className="text-muted-foreground" />}
                          <span className="flex-1 text-[0.933rem] font-medium text-foreground">{cmd.label}</span>
                          {cmd.shortcut && (
                            <kbd className="cockpit-kbd">
                              {cmd.shortcut}
                            </kbd>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-4 border-t border-border/60 bg-background/45 px-4 py-3 text-[0.733rem] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="cockpit-kbd">↑↓</kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="cockpit-kbd">↵</kbd> run
              </span>
              <span className="flex items-center gap-1">
                <kbd className="cockpit-kbd">esc</kbd> close
              </span>
            </div>
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
