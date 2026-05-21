import type { LucideIcon } from 'lucide-react';
import { Paperclip, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { TreeEntry } from './types';

export interface FileTreeMenuAction {
  id: 'restore' | 'add-to-chat' | 'rename' | 'trash';
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  onSelect: () => void;
}

export interface FileTreeMenuActionOptions {
  addToChatEnabled: boolean;
  canAddToChat: boolean;
  isCustomWorkspace: boolean;
  onRestore: () => void;
  onAddToChat: () => void;
  onRename: () => void;
  onTrash: () => void;
}

function isTrashItemPath(filePath: string): boolean {
  return filePath.startsWith('.trash/');
}

export function buildFileTreeMenuActions(
  entry: TreeEntry,
  options: FileTreeMenuActionOptions,
): FileTreeMenuAction[] {
  const path = entry.path;
  const inTrash = isTrashItemPath(path);
  const actions: FileTreeMenuAction[] = [];

  if (inTrash) {
    actions.push({
      id: 'restore',
      label: 'Restore',
      icon: RotateCcw,
      onSelect: options.onRestore,
    });
  }

  if (!path.startsWith('.trash') && options.canAddToChat && (entry.type === 'directory' || options.addToChatEnabled)) {
    actions.push({
      id: 'add-to-chat',
      label: 'Add to chat',
      icon: Paperclip,
      onSelect: options.onAddToChat,
    });
  }

  if (path !== '.trash') {
    actions.push({
      id: 'rename',
      label: 'Rename',
      icon: Pencil,
      onSelect: options.onRename,
    });
  }

  if (!inTrash && path !== '.trash') {
    actions.push({
      id: 'trash',
      label: options.isCustomWorkspace ? 'Permanently Delete' : 'Move to Trash',
      icon: Trash2,
      destructive: true,
      onSelect: options.onTrash,
    });
  }

  return actions;
}
