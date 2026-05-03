import { useCallback, type ReactNode } from 'react';
import { MessageSquare, Search, RefreshCw, Settings, Plus, Command } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QuickAction {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  shortcut?: string;
  action: () => void;
}

interface EmptyChatStateProps {
  agentName: string;
  actions?: QuickAction[];
  onOpenCommandPalette?: () => void;
  onNewSession?: () => void;
  onSearch?: () => void;
  onRefresh?: () => void;
  onSettings?: () => void;
  className?: string;
}

const DEFAULT_ACTIONS: QuickAction[] = [];

/** Empty chat state with quick-action command cards. */
export function EmptyChatState({
  agentName,
  actions = DEFAULT_ACTIONS,
  onOpenCommandPalette,
  onNewSession,
  onSearch,
  onRefresh,
  onSettings,
  className,
}: EmptyChatStateProps) {
  // Build default quick actions if none provided
  const defaultActions: QuickAction[] = actions.length > 0 ? actions : [
    ...(onOpenCommandPalette ? [{
      id: 'command-palette',
      label: 'Command Palette',
      description: 'Browse all commands',
      icon: <Command size={16} />,
      shortcut: '⌘K',
      action: onOpenCommandPalette,
    }] : []),
    ...(onNewSession ? [{
      id: 'new-session',
      label: 'New Session',
      description: 'Start a fresh conversation',
      icon: <Plus size={16} />,
      action: onNewSession,
    }] : []),
    ...(onSearch ? [{
      id: 'search',
      label: 'Search Messages',
      description: 'Find something in history',
      icon: <Search size={16} />,
      shortcut: '⌘F',
      action: onSearch,
    }] : []),
    ...(onRefresh ? [{
      id: 'refresh',
      label: 'Refresh Sessions',
      description: 'Reload session list',
      icon: <RefreshCw size={16} />,
      action: onRefresh,
    }] : []),
    ...(onSettings ? [{
      id: 'settings',
      label: 'Settings',
      description: 'Configure connection & preferences',
      icon: <Settings size={16} />,
      action: onSettings,
    }] : []),
  ];

  const handleKeyDown = useCallback((e: React.KeyboardEvent, action: QuickAction) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action.action();
    }
  }, []);

  return (
    <div className={cn('flex-1 flex flex-col items-center justify-center gap-6 px-6 py-8 select-none', className)}>
      {/* Agent greeting */}
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="size-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <MessageSquare size={22} className="text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {agentName}
        </h2>
        <p className="text-sm text-muted-foreground max-w-[280px]">
          Type a message below, or pick a quick action to get started.
        </p>
      </div>

      {/* Quick action cards */}
      {defaultActions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-[400px] w-full">
          {defaultActions.map((action) => (
            <button
              key={action.id}
              onClick={action.action}
              onKeyDown={(e) => handleKeyDown(e, action)}
              className={cn(
                'flex items-center gap-3 px-3.5 py-2.5 rounded-xl',
                'bg-card/80 border border-border/60',
                'text-left text-sm text-foreground',
                'hover:bg-accent/60 hover:border-primary/30',
                'active:scale-[0.98] transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              )}
            >
              <span className="shrink-0 text-muted-foreground">{action.icon || <MessageSquare size={16} />}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[0.8rem] truncate">{action.label}</div>
                {action.description && (
                  <div className="text-[0.7rem] text-muted-foreground truncate">{action.description}</div>
                )}
              </div>
              {action.shortcut && (
                <span className="shrink-0 text-[0.65rem] text-muted-foreground/60 font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                  {action.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}