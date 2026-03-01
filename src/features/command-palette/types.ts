import type { ReactNode } from 'react';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;        // Display string like "⌘K"
  icon?: ReactNode;
  action: () => void;
  category?: 'navigation' | 'actions' | 'settings' | 'appearance' | 'voice' | 'kanban';
  keywords?: string[];      // Additional search terms
}
