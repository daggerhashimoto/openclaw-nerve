/**
 * The Config tab's picker: the agent's workspace files plus the installed-skills view.
 * Shared by ConfigTab (which shows a file) and WorkspacePanel (which mounts the Skills
 * view under the same picker), so the two views read as one control.
 */

import type { InlineSelectOption } from '@/components/ui/InlineSelect';
import { getWorkspaceStorageKey } from '../workspaceScope';

export const CONFIG_FILE_OPTIONS = [
  { key: 'soul', label: 'SOUL.md' },
  { key: 'tools', label: 'TOOLS.md' },
  { key: 'identity', label: 'IDENTITY.md' },
  { key: 'user', label: 'USER.md' },
  { key: 'agents', label: 'AGENTS.md' },
  { key: 'heartbeat', label: 'HEARTBEAT.md' },
  { key: 'chatPathLinks', label: 'CHAT_PATH_LINKS.json' },
];

export const DEFAULT_CONFIG_KEY = 'soul';

/** The Skills view sits at the end of the same picker as the files. */
export const SKILLS_VIEW_OPTION: InlineSelectOption = { value: 'skills', label: 'Skills' };

export function configFileOptions(): InlineSelectOption[] {
  return CONFIG_FILE_OPTIONS.map(file => ({ value: file.key, label: file.label }));
}

export function getSelectedConfigStorageKey(agentId: string): string {
  return getWorkspaceStorageKey('config:selected-file', agentId);
}

export function getInitialSelectedKey(agentId: string): string {
  try {
    const stored = localStorage.getItem(getSelectedConfigStorageKey(agentId));
    if (stored && CONFIG_FILE_OPTIONS.some(file => file.key === stored)) {
      return stored;
    }
  } catch {
    // ignore storage errors
  }

  return DEFAULT_CONFIG_KEY;
}

export function rememberSelectedConfigFile(agentId: string, key: string): void {
  try {
    localStorage.setItem(getSelectedConfigStorageKey(agentId), key);
  } catch {
    // ignore storage errors
  }
}

/** The picker sits flat on the panel row: name and chevron, Raised on hover, no drawn box. */
export const CONFIG_SELECT_TRIGGER_CLASS =
  'min-h-11 w-full justify-between rounded-[3px] border-transparent bg-transparent px-2 py-1 text-[0.867rem] font-medium text-foreground sm:min-h-[var(--row-unit)] sm:px-2 sm:py-0 sm:text-[0.867rem]';

export const CONFIG_SELECT_MENU_CLASS =
  'rounded-[3px] border-border bg-popover py-1 shadow-[0_12px_32px_rgba(0,0,0,0.32)]';
