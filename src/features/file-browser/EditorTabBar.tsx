import { EditorTab } from './EditorTab';
import type { OpenFile } from './types';
import type { OpenBeadTab } from '@/features/beads';

interface EditorTabBarProps {
  activeTab: string;
  openFiles: OpenFile[];
  openBeads?: OpenBeadTab[];
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function EditorTabBar({
  activeTab,
  openFiles,
  openBeads = [],
  onSelectTab,
  onCloseTab,
}: EditorTabBarProps) {
  // Don't render tab bar if no file/bead tabs are open (chat-only mode)
  if (openFiles.length === 0 && openBeads.length === 0) return null;

  return (
    <div
      className="flex items-center h-9 border-b border-border bg-background overflow-x-auto scrollbar-hide"
      role="tablist"
      aria-label="Open files"
    >
      {/* Pinned chat tab */}
      <EditorTab
        id="chat"
        label="Chat"
        active={activeTab === 'chat'}
        pinned
        onSelect={() => onSelectTab('chat')}
      />

      {/* File tabs */}
      {openFiles.map((file) => (
        <EditorTab
          key={file.path}
          id={file.path}
          label={file.name}
          active={activeTab === file.path}
          dirty={file.dirty}
          locked={file.locked}
          tooltip={file.path}
          onSelect={() => onSelectTab(file.path)}
          onClose={() => onCloseTab(file.path)}
          onMiddleClick={() => onCloseTab(file.path)}
        />
      ))}

      {/* Bead viewer tabs */}
      {openBeads.map((bead) => (
        <EditorTab
          key={bead.id}
          id={bead.id}
          label={bead.name}
          active={activeTab === bead.id}
          tooltip={bead.beadId}
          onSelect={() => onSelectTab(bead.id)}
          onClose={() => onCloseTab(bead.id)}
          onMiddleClick={() => onCloseTab(bead.id)}
        />
      ))}
    </div>
  );
}
