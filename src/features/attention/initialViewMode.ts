import type { ViewMode } from '@/features/command-palette/commands';

/**
 * The view a page load opens on. Attention when nothing is saved, and once for an existing
 * install on the first load after the upgrade (`introFresh`); after that the saved mode, with a
 * saved Tasks view falling back to Chat while kanban is hidden.
 */
export function getInitialViewMode(
  canShowKanban: boolean,
  storage: { saved: string | null; introFresh: boolean },
): ViewMode {
  const { saved, introFresh } = storage;
  if (saved === null || introFresh) return 'attention';
  if (saved === 'kanban') return canShowKanban ? 'kanban' : 'chat';
  if (saved === 'chat' || saved === 'attention') return saved;
  return 'attention';
}
