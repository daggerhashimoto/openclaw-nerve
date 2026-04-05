# Nerve UI Design Document
## Comprehensive Code Review & Component Architecture

**Date:** 2026-04-05  
**Version:** 1.0  
**Framework:** React 18 + TypeScript + Vite  
**UI Library:** Custom component library with shadcn/ui primitives  

---

## Executive Summary

Nerve is a sophisticated agent control dashboard with a modular, feature-driven architecture. The UI is organized into **7 major tile/panel systems**, each with specialized subcomponents. The design follows consistent naming conventions and a shell-panel layout system with lazy loading and error boundaries.

---

## Architecture Overview

### Top-Level Application Structure

**File:** `src/App.tsx` (39,298 lines)

The main application is a single-page React component that orchestrates:
- Gateway connection state management
- Session/agent lifecycle
- Chat interface with voice input
- File browser with editor tabs
- Responsive layout (desktop/mobile)
- Keyboard shortcuts
- Error boundaries

### Layout System

```
┌─────────────────────────────────────────────────────┐
│  TopBar (Agents, Events, Logs, Settings, View Mode) │
├─────────────────────────────────────────────────────┤
│ ┌──────────────────┐  ┌──────────────────────────┐  │
│ │  FileTreePanel   │  │   Main Content Area      │  │
│ │  (File Browser)  │  │   (Chat or Kanban)       │  │
│ │                  │  │                          │  │
│ │  • Desktop:      │  │  ┌────────────────────┐  │  │
│ │    Sidebar       │  │  │ ChatPanel          │  │  │
│ │  • Mobile:       │  │  │ • Messages         │  │  │
│ │    Drawer       │  │  │ • InputBar         │  │  │
│ │                  │  │  │ • ActivityLog      │  │  │
│ │                  │  │  └────────────────────┘  │  │
│ │                  │  │                          │  │
│ │                  │  │  Right Panels (Desktop):  │  │
│ │                  │  │  • SessionList          │  │
│ │                  │  │  • WorkspacePanel       │  │
│ └──────────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  StatusBar (Connection, Sessions, Context Usage)    │
└─────────────────────────────────────────────────────┘
```

---

## Major UI Tiles & Panels

### 1. **TOPBAR** (`src/components/TopBar.tsx`)
**Designation:** Primary navigation and status header  
**Position:** Top of viewport (fixed)  
**Styling:** Shell-like design with icon bar

#### Subcomponents:
- **NerveLogo** - Application branding/logo
- **Agent Log Display** - Real-time agent activity with glow indicator
- **Event Log Display** - System events viewer
- **Token Usage Badge** - Context token consumption meter
- **Settings Button** - Opens SettingsDrawer
- **View Mode Toggle** - Switch between Chat/Kanban views
- **Mobile Panel Buttons** (Compact Layout) - SessionList and WorkspacePanel drawers

#### Props Interface:
```typescript
{
  onSettings: () => void
  agentLogEntries: LogEntry[]
  tokenData: TokenData
  logGlow: boolean
  eventEntries: EventEntry[]
  eventsVisible: boolean
  logVisible: boolean
  mobilePanelButtonsVisible: boolean
  sessionsPanel: React.ReactNode
  workspacePanel: React.ReactNode
  viewMode: 'chat' | 'kanban'
  onViewModeChange: (mode: ViewMode) => void
}
```

---

### 2. **AGENTS PANEL** (`src/features/sessions/SessionList.tsx`)
**Designation:** Agent/session management and creation  
**Position:** Right sidebar (desktop) / Drawer (mobile)  
**Key Icon:** Brain icon or Lucide `Users`

#### Subcomponents:
- **SessionList** - Main container (root component)
  - **SessionTree** - Hierarchical session display
    - **SessionNode** - Individual session item
      - Status indicator (online, idle, error)
      - Unread badge
      - Busy spinner
      - Action menu (rename, delete, abort)
  - **SpawnAgentDialog** - Modal for creating new agents
    - Agent name input
    - Parent session selector
    - Root vs. child agent toggle
  - **SessionInfoPanel** - Detailed session metadata
    - Model info
    - Token usage
    - Context window display
    - Timestamps
  - **Refresh Button** - Reload session list from gateway

#### Key Utilities:
- `buildAgentRootSessionKey()` - Generate unique agent identifiers
- `getSessionDisplayLabel()` - Human-readable session names
- `getSessionKey()` - Extract canonical session key
- `buildSpawnSubagentMessage()` - Format agent spawn requests

#### Props Interface:
```typescript
interface SessionListProps {
  sessions: SessionData[]
  currentSession: string
  busyState: Map<string, boolean>
  agentStatus: Map<string, AgentStatus>
  unreadSessions: Set<string>
  onSelect: (key: string) => Promise<void> | void
  onRefresh: () => void
  onDelete: (key: string) => Promise<void>
  onSpawn: (opts: SpawnSessionOpts) => Promise<boolean>
  onRename: (key: string, label: string) => Promise<void>
  onAbort: (key: string) => Promise<void>
  isLoading: boolean
  agentName: string
  compact?: boolean
}
```

#### Naming Convention:
- `SessionNode` - Individual item row
- `SessionList` - Container
- `SessionTree` - Hierarchical organizer
- `SessionNode.tsx`, `SessionList.tsx`, `sessionTree.ts` - File structure

---

### 3. **WORKSPACE PANEL** (`src/features/workspace/WorkspacePanel.tsx`)
**Designation:** Project configuration, memory, crons, and tasks  
**Position:** Right sidebar (desktop) / Drawer (mobile)  
**Key Icon:** Settings or Columns3 icon

#### Tabs:
1. **MEMORY Tab** (`MemoryList.tsx`)
   - Memory list viewer
   - Add memory dialog
   - Memory editor modal

2. **CRONS Tab** (`CronsTab.tsx`)
   - Cron job list
   - CronDialog for CRUD operations
   - Job execution history
   - Schedule expression validator

3. **TASKS Tab** (Kanban Quick View)
   - Quick view of active tasks
   - Task filtering

4. **CONFIG Tab** (`ConfigTab.tsx` / `SkillsTab.tsx`)
   - **Subview Toggle:** Files / Skills
   - Files view:
     - Project configuration files
     - Environment variables
     - Manifest display
   - Skills view:
     - Installed skills list
     - Skill browser
     - Install/uninstall actions

#### Subcomponents:
- **WorkspaceTabs** - Tab bar header
  - Brain icon → Memory
  - Clock icon → Crons
  - Columns3 icon → Tasks
  - Settings icon → Config
- **MemoryList** - Memory list container
  - **MemoryItem** - Individual memory card
  - **AddMemoryDialog** - Add memory modal
  - **MemoryEditor** - Edit memory content
  - **ConfirmDeleteDialog** - Delete confirmation
- **CronsTab** - Cron jobs container
  - **CronDialog** - Create/edit cron job
    - Cron expression input
    - Timezone selector
    - Payload editor
    - Schedule picker UI
  - Cron job table/list
- **ConfigTab** - Files/config viewer
- **SkillsTab** - Skills manager

#### Props Interface:
```typescript
interface WorkspacePanelProps {
  workspaceAgentId: string
  memories: Memory[]
  onRefreshMemories: () => Promise<void>
  memoriesLoading: boolean
  remoteWorkspace: WorkspaceData
  compact?: boolean
  onOpenBoard: () => void
  onOpenTask: (taskId: string) => void
}
```

#### Naming Convention:
- `WorkspacePanel.tsx` - Main container
- `WorkspaceTabs.tsx` - Tab bar
- `MemoryTab.tsx`, `CronsTab.tsx`, `ConfigTab.tsx`, `SkillsTab.tsx` - Tab content
- `tabs/` - Directory for tab implementations
- `hooks/useCrons.ts` - Cron data management hook

---

### 4. **CHAT PANEL** (`src/features/chat/ChatPanel.tsx`)
**Designation:** Main conversational interface  
**Position:** Center/left of viewport  
**Key Components:** Messages, input, activity log

#### Subcomponents:
- **ChatPanel** - Main chat container (ref-forwarding component)
  - **MessageBubble** - Individual message display
    - Message content (text/markdown)
    - **ToolCallBlock** - Tool invocation display
    - **FileContentView** - File preview in chat
    - **ImageLightbox** - Image zoom viewer
  - **InputBar** - User message input
    - Text input field
    - Voice input controls (STT)
    - Send button
    - Abort button (when generating)
  - **ChatHeader** - Session info and controls
    - Session name
    - Agent model indicator
    - Token usage display
    - Reset button
  - **ScrollToBottomButton** - Auto-scroll for new messages
  - **SearchBar** - Message search
    - **useMessageSearch** hook for filtering
  - **ActivityLog** - Real-time processing indicators
    - **ProcessingIndicator** - Spinning loader
    - **HeartbeatPulse** - Connection pulse
    - **ThinkingDots** - Animated thinking state
  - **StreamingMessage** - Partial message display during generation
  - **MemoriesSection** - Related memories sidebar
  - **DiffView** - Side-by-side code changes (for file edits)

#### Key Utilities:
- `extractImages()` - Parse image URLs from messages
- `image-compress.ts` - Optimize image payloads
- `useMessageSearch.ts` - Message filtering hook

#### Props Interface:
```typescript
interface ChatPanelProps {
  id: string
  messages: Message[]
  onSend: (text: string) => void
  onAbort: () => void
  isGenerating: boolean
  stream: StreamData
  processingStage: ProcessingStage
  lastEventTimestamp: number
  currentToolDescription: string | null
  activityLog: ActivityLogEntry[]
  onWakeWordState?: (state: WakeWordState) => void
  onReset: () => void
  searchOpen: boolean
  onSearchClose: () => void
  agentName: string
  loadMore: () => void
  hasMore: boolean
  onToggleFileBrowser?: () => void
  isFileBrowserCollapsed?: boolean
  onToggleMobileTopBar?: () => void
  isMobileTopBarHidden?: boolean
  onOpenWorkspacePath?: (path: string) => void
}
```

#### Naming Convention:
- `ChatPanel.tsx` - Main container
- `MessageBubble.tsx` - Message display
- `InputBar.tsx` - Input control
- `ToolCallBlock.tsx` - Tool invocation display
- `ChatHeader.tsx` - Title bar
- `components/` - Subcomponent directory

---

### 5. **FILE BROWSER** (`src/features/file-browser/FileTreePanel.tsx`)
**Designation:** Project file navigation and editing  
**Position:** Left sidebar (desktop) / Drawer (mobile)  
**Collapsible:** Yes (toggle button)

#### Subcomponents:
- **FileTreePanel** - Main file browser container
  - Collapse/expand button
  - Breadcrumb navigation
  - **FileTreeNode** - File/directory tree items
    - Expand/collapse arrow
    - File icon (by type)
    - File name label
    - Right-click context menu
    - Nested children
  - Directory view controls
- **EditorTabBar** - Tab bar for open files
  - **EditorTab** - Individual file tab
    - File name
    - Dirty indicator (unsaved dot)
    - Close button
    - Right-click menu
- **TabbedContentArea** - Content switching
  - **FileEditor** - Monaco editor integration
    - Syntax highlighting (language auto-detect)
    - Theme support (dark/light)
    - Save indicator
    - Error display
    - **editorTheme.ts** - Theme configuration
  - **ImageViewer** - Image preview
    - Zoom controls
    - Download button
  - **DiffView** - Show file changes
- **useOpenFiles** - State management hook
  - Track open tabs
  - Manage dirty state
  - File save/reload operations

#### Key Utilities:
- `fileIcons.tsx` - Icon mapping by file type
- `languageMap.ts` - Language detection
- `fileTypes.ts` - File classification
- `useFileTree.ts` - Directory tree navigation

#### Props Interface:
```typescript
interface FileTreePanelProps {
  workspaceAgentId: string
  onOpenFile: (path: string) => Promise<void>
  lastChangedEvent: FileTreeChangeEvent | null
  revealRequest: RevealRequest | null
  onRemapOpenPaths: (mapping: Record<string, string>) => void
  onCloseOpenPaths: (prefix: string) => void
  isCompactLayout: boolean
  collapsed: boolean
  onCollapseChange: (collapsed: boolean) => void
}
```

#### Naming Convention:
- `FileTreePanel.tsx` - Main container
- `FileTreeNode.tsx` - Individual tree item
- `EditorTabBar.tsx` - Tab bar
- `EditorTab.tsx` - Single tab
- `TabbedContentArea.tsx` - Content area
- `FileEditor.tsx` - Editor wrapper
- `ImageViewer.tsx` - Image display
- `utils/fileIcons.tsx` - Utilities directory
- `hooks/useOpenFiles.ts` - Custom hooks

---

### 6. **KANBAN BOARD** (`src/features/kanban/KanbanPanel.tsx`)
**Designation:** Task/project management view  
**Position:** Replaces ChatPanel when view mode = 'kanban'  
**Toggle:** View mode button in TopBar

#### Subcomponents:
- **KanbanPanel** - Main kanban container
  - **KanbanHeader** - Title and controls
    - Add task button
    - Filter/sort controls
  - **KanbanBoard** - Column-based grid
    - **KanbanColumn** - Individual column
      - Column title
      - Card count badge
      - Drop zone for drag-drop
      - **KanbanCard** - Task card
        - Task title
        - Priority badge
        - Assignee avatar
        - Due date
        - Right-click menu
        - Drag handle
    - **CreateTaskDialog** - Add/edit task modal
    - **TaskDetailDrawer** - Full task editor
      - Description
      - Checklist
      - Comments
      - Attachments
      - Status updates
  - **KanbanQuickView** - Compact card view (in WorkspacePanel)
  - **ProposalInbox** - Proposed changes queue

#### Key Utilities:
- `lib/` - Kanban utilities
- `hooks/` - Task management hooks
- `tone.ts` - Task tone/priority mapping
- `types.ts` - Task data structures

#### Props Interface:
```typescript
interface KanbanPanelProps {
  initialTaskId?: string | null
  onInitialTaskConsumed: () => void
}
```

#### Naming Convention:
- `KanbanPanel.tsx` - Main container
- `KanbanBoard.tsx` - Grid container
- `KanbanColumn.tsx` - Column container
- `KanbanCard.tsx` - Card item
- `KanbanHeader.tsx` - Title bar
- `TaskDetailDrawer.tsx` - Task editor
- `CreateTaskDialog.tsx` - Add task modal

---

### 7. **STATUS BAR** (`src/components/StatusBar.tsx`)
**Designation:** Bottom status and connection display  
**Position:** Bottom of viewport (fixed)  
**Content:** Connection state, session count, context usage

#### Subcomponents:
- **StatusBar** - Main status bar container
  - **ContextMeter** - Token usage visualization
    - Progress bar
    - Percentage display
    - Current / Max tokens
  - Connection indicator
    - Dot (green/red/yellow)
    - Status text
  - Session counter
  - Sparkline graph (historical usage)
  - Update badge (if available)

#### Props Interface:
```typescript
interface StatusBarProps {
  connectionState: ConnectionState
  sessionCount: number
  sparkline: number[]
  contextTokens: number
  contextLimit: number
}
```

---

## Supporting Infrastructure

### 8. **SETTINGS DRAWER** (`src/features/settings/SettingsDrawer.tsx`)
**Designation:** Application preferences and configuration  
**Position:** Overlay drawer (right side)  
**Trigger:** Settings button in TopBar

#### Tabs/Sections:
- **ConnectionSettings** - Gateway URL and auth token
- **AudioSettings** - Sound preferences, TTS/STT config
  - TTS provider selector (Google, OpenAI, custom)
  - TTS model selector
  - Voice selection
  - STT input mode (push-to-talk, continuous, etc.)
  - Wake word settings
  - Live transcription preview
- **AppearanceSettings** - Theme and font preferences
  - Dark/light mode toggle
  - Font size adjuster
  - Font family selector

#### Naming Convention:
- `SettingsDrawer.tsx` - Main drawer
- `ConnectionSettings.tsx` - Connection section
- `AudioSettings.tsx` - Audio section
- `AppearanceSettings.tsx` - Appearance section

---

### 9. **COMMAND PALETTE** (`src/features/command-palette/CommandPalette.tsx`)
**Designation:** Keyboard-driven command interface  
**Trigger:** Cmd+K (Mac) / Ctrl+K (Windows)  
**UI:** Modal with search and command list

#### Commands Available:
- New session
- Reset session
- Toggle sound
- Open settings
- Search messages
- Set theme
- Change TTS provider
- Toggle wake word
- Toggle logs
- View modes

#### Naming Convention:
- `CommandPalette.tsx` - Main modal
- `commands.ts` - Command definitions

---

## Component Naming Conventions

### File Structure Pattern
```
src/features/[feature-name]/
├── [FeatureName].tsx          # Main container component
├── [SubComponent].tsx          # Subcomponents
├── types.ts                   # TypeScript interfaces
├── components/                # Sub-feature components
│   ├── ComponentA.tsx
│   └── index.ts               # Barrel export
├── hooks/                     # Custom React hooks
│   ├── useCustomHook.ts
│   └── index.ts
├── utils/                     # Utility functions
│   ├── helper.ts
│   └── index.ts
└── [Feature].test.tsx         # Tests
```

### Naming Rules

| Pattern | Example | Usage |
|---------|---------|-------|
| `[Name]Panel` | `ChatPanel`, `WorkspacePanel` | Main container for a tile |
| `[Name]Tabs` | `WorkspaceTabs` | Tab bar component |
| `[Name]Tab` | `MemoryTab`, `CronsTab` | Individual tab content |
| `[Name]Dialog` | `CronDialog`, `SpawnAgentDialog` | Modal dialogs |
| `[Name]List` | `SessionList`, `MemoryList` | List/table containers |
| `[Name]Item` | `MemoryItem`, `SessionNode` | Individual list items |
| `use[Name]` | `useOpenFiles`, `useCrons` | Custom hooks |
| `get[Name]` | `getSessionKey`, `getSessionDisplayLabel` | Utility functions |
| `[name].ts` | `editorTheme.ts`, `fileTypes.ts` | Configuration/utilities |

---

## Responsive Design

### Breakpoints
- **Desktop:** `>= 900px` - Multi-panel layout
- **Tablet/Mobile:** `< 900px` - Compact layout (chat-first)

### Layout Modes

#### Desktop Layout
- FileTree sidebar (collapsible, toggleable)
- Main chat/kanban area (resizable)
- Right panel stack: SessionList + WorkspacePanel

#### Mobile Layout
- File browser as full-screen drawer
- Chat as primary view
- SessionList and WorkspacePanel as modal drawers (TopBar buttons)
- TopBar hidden when scrolling (toggle button)

### ResizablePanels Component
- `src/components/ResizablePanels.tsx`
- Provides draggable dividers between panels
- Stores resize ratios in React state
- Props: `leftPercent`, `onResize`, `minLeftPercent`, `maxLeftPercent`

---

## Context & State Management

### React Contexts
1. **GatewayContext** - WebSocket connection state
2. **SessionContext** - Agent/session list and operations
3. **ChatContext** - Message history and chat state
4. **SettingsContext** - User preferences

### Custom Hooks (Feature-Specific)
- `useOpenFiles` - File editor tabs and content
- `useDashboardData` - Memory/workspace fetch
- `useCrons` - Cron job management
- `useConnectionManager` - Gateway connection lifecycle
- `useMessageSearch` - Chat message filtering
- `useKeyboardShortcuts` - Global keyboard bindings

---

## Error Handling

### Error Boundaries
- **PanelErrorBoundary** - Wraps each major panel
  - Catches rendering errors in isolated panels
  - Shows error message without crashing entire app
  - Fallback: `"Error loading [panel name]"`

### Lazy Loading
- `React.lazy()` + `<Suspense>` for:
  - SettingsDrawer
  - CommandPalette
  - SessionList
  - WorkspacePanel
  - KanbanPanel

### Toast Notifications
- Save conflict warnings (file changed on disk)
- Workspace switch confirmations
- Gateway restart notices

---

## Styling Architecture

### CSS
- **src/index.css** - Global styles + Tailwind config
- **Tailwind CSS** - Utility-first styling
- Custom design tokens:
  - Color palette (purple accents)
  - Rounded corners (`rounded-[28px]` for panels)
  - Spacing scale
  - Typography scale

### CSS Classes Pattern
```typescript
// Panel base styling
className="shell-panel flex flex-col rounded-[28px] overflow-hidden"

// Responsive modifiers
className="flex gap-3 px-2 pt-1.5 pb-2 sm:px-4 sm:pt-2 sm:pb-2"

// Boot animation
className="boot-panel" // Fades in on connection
```

### Shadow & Depth
- Panels: Subtle box-shadow
- Modals: Darker background with blur
- Status bar: Light shadow for elevation

---

## Accessibility Features

### ARIA Labels
- `role="tablist"` for tab bars
- `aria-label="Skip to chat"` for keyboard navigation
- Proper heading hierarchy
- Icon-only buttons have `aria-label`

### Keyboard Navigation
- Tab order through interactive elements
- Arrow keys for tab switching
- Escape key to close modals
- Cmd+K / Ctrl+K for command palette
- Cmd+B to toggle file browser
- Cmd+F to search messages

### Screen Reader Support
- Semantic HTML
- Descriptive labels on inputs
- Status live regions (for connection state)

---

## Performance Optimizations

### Code Splitting
- Lazy load non-critical panels
- Separate bundle for each feature

### Memoization
- `useMemo` for expensive computations
- `useCallback` for event handlers
- Prevent unnecessary re-renders

### Virtual Scrolling
- Used in long lists (SessionList, MemoryList)
- Window-based rendering for large datasets

### Image Optimization
- `image-compress.ts` - Compress before sending
- ImageViewer with lazy load

---

## File Statistics

| Feature | Files | Primary Components |
|---------|-------|-------------------|
| Chat | ~15 | ChatPanel, MessageBubble, InputBar |
| Sessions | ~8 | SessionList, SessionNode, SpawnAgentDialog |
| Workspace | ~12 | WorkspacePanel, MemoryTab, CronsTab, ConfigTab |
| File Browser | ~10 | FileTreePanel, FileEditor, EditorTabBar |
| Kanban | ~10 | KanbanPanel, KanbanBoard, TaskDetailDrawer |
| Settings | ~5 | SettingsDrawer, AudioSettings |
| Components | ~10 | TopBar, StatusBar, ResizablePanels |
| **Total** | **~70** | **~30+ major components** |

---

## Key Design Principles

1. **Modular Architecture**
   - Each feature self-contained
   - Minimal cross-feature dependencies
   - Lazy loading for performance

2. **Shell-Panel Design**
   - Consistent rounded corners and shadows
   - Diamond-headed section titles (◆)
   - Unified spacing and padding

3. **Responsive First**
   - Mobile-optimized drawer system
   - Desktop multi-panel layout
   - Graceful degradation

4. **Error Resilience**
   - Panel-level error boundaries
   - Graceful error messages
   - Session recovery flows

5. **Accessibility**
   - Keyboard-first navigation
   - Screen reader support
   - WCAG compliance

6. **Real-Time UX**
   - WebSocket-driven updates
   - Streaming message display
   - Live transcription preview
   - Animated indicators (thinking dots, pulse)

---

## Future Extension Points

### Planned Features
1. **Plugin System** - Load custom tiles from skills
2. **Drag-Drop Reordering** - Rearrange panels
3. **Custom Themes** - User-defined color schemes
4. **Multi-Session Chat** - Parallel conversations
5. **Memory Browser** - Full-text search with vectors
6. **Cron Analytics** - Job run history and stats

### Extension Hooks
- Panel registration system
- Custom keyboard shortcuts
- Theme customization API
- WebSocket event handlers

---

## Summary Table

| Tile | File | Main Component | Position | Toggle |
|------|------|---|---|---|
| **TopBar** | `TopBar.tsx` | TopBar | Top | Fixed |
| **Agents** | `SessionList.tsx` | SessionList | Right/Mobile | Drawer |
| **Workspace** | `WorkspacePanel.tsx` | WorkspacePanel | Right/Mobile | Drawer |
| **Chat** | `ChatPanel.tsx` | ChatPanel | Center/Full | View mode |
| **Kanban** | `KanbanPanel.tsx` | KanbanPanel | Center/Full | View mode |
| **File Browser** | `FileTreePanel.tsx` | FileTreePanel | Left/Mobile | Collapse/Drawer |
| **Settings** | `SettingsDrawer.tsx` | SettingsDrawer | Overlay | Button |
| **Status** | `StatusBar.tsx` | StatusBar | Bottom | Fixed |

---

## Document Metadata

- **Total Components:** 30+
- **Total Features:** 8
- **Lines of Code:** ~4,500 (feature components)
- **CSS:** Tailwind + Custom CSS
- **State:** React Context + Custom Hooks
- **Architecture:** Feature-first, Component-based
- **Maintainability:** High (modular, lazy-loaded)
- **Scalability:** Extensible panel system

---

**End of Design Document**

*For questions or updates, refer to individual feature READMEs or component JSDoc comments.*
