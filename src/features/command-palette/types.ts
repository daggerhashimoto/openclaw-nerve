import type { ReactNode } from 'react';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;        // Display string like "⌘K"
  icon?: ReactNode;
  action: () => void;
  category?: 'navigation' | 'actions' | 'settings' | 'appearance' | 'voice' | 'kanban' | 'sessions';
  keywords?: string[];      // Additional search terms
  isActive?: boolean;       // Renders an active-state affordance (e.g. current session)
}
