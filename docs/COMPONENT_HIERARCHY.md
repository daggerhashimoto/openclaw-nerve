# Nerve Component Hierarchy Reference
## Quick Visual Index

```
App.tsx (Main orchestrator)
│
├─ TopBar.tsx (Fixed header)
│  ├─ NerveLogo
│  ├─ AgentLog Display
│  ├─ EventLog Display
│  ├─ TokenUsage Badge
│  ├─ Settings Button
│  ├─ View Mode Toggle (Chat/Kanban)
│  └─ Mobile: SessionList Drawer Button
│     └─ Mobile: WorkspacePanel Drawer Button
│
├─ Main Layout Container (Flex with ResizablePanels)
│  │
│  ├─ [Desktop Only] FileTreePanel.tsx (Left sidebar)
│  │  ├─ Collapse Toggle Button
│  │  ├─ FileTreeNode (Recursive)
│  │  │  ├─ Expand/Collapse Arrow
│  │  │  ├─ File Icon
│  │  │  ├─ File Name
│  │  │  ├─ Context Menu
│  │  │  └─ [Nested] FileTreeNode...
│  │  │
│  │  └─ EditorTabBar.tsx
│  │     ├─ EditorTab (Multiple)
│  │     │  ├─ File Name
│  │     │  ├─ Dirty Indicator
│  │     │  └─ Close Button
│  │     │
│  │     └─ TabbedContentArea.tsx
│  │        ├─ FileEditor.tsx
│  │        │  └─ Monaco Editor Instance
│  │        ├─ ImageViewer.tsx
│  │        └─ DiffView.tsx
│  │
│  ├─ [Mobile Drawer] FileTreePanel (Same as desktop, overlay)
│  │
│  ├─ Main Content Area (Resizable, flex-1)
│  │  │
│  │  ├─ [View Mode: Chat] ChatPanel.tsx
│  │  │  ├─ ChatHeader.tsx
│  │  │  │  ├─ Session Name
│  │  │  │  ├─ Model Info
│  │  │  │  └─ Reset Button
│  │  │  │
│  │  │  ├─ Message List (Scrollable)
│  │  │  │  ├─ MessageBubble (Multiple)
│  │  │  │  │  ├─ Message Content (Markdown)
│  │  │  │  │  ├─ ToolCallBlock (If tool use)
│  │  │  │  │  ├─ FileContentView (If code)
│  │  │  │  │  └─ ImageLightbox (If images)
│  │  │  │  │
│  │  │  │  └─ StreamingMessage (Active generation)
│  │  │  │
│  │  │  ├─ ActivityLog.tsx (Right sidebar, chat messages)
│  │  │  │  ├─ ProcessingIndicator
│  │  │  │  ├─ HeartbeatPulse
│  │  │  │  └─ ThinkingDots
│  │  │  │
│  │  │  ├─ SearchBar.tsx (If searchOpen)
│  │  │  │  └─ useMessageSearch hook
│  │  │  │
│  │  │  ├─ MemoriesSection.tsx (Related memories)
│  │  │  │
│  │  │  ├─ InputBar.tsx (Bottom)
│  │  │  │  ├─ Text Input Field
│  │  │  │  ├─ Voice Input Controls
│  │  │  │  ├─ Send Button
│  │  │  │  └─ Abort Button (When generating)
│  │  │  │
│  │  │  ├─ ScrollToBottomButton
│  │  │  │
│  │  │  └─ DiffView (If showing code changes)
│  │  │
│  │  └─ [View Mode: Kanban] KanbanPanel.tsx
│  │     ├─ KanbanHeader.tsx
│  │     │  ├─ Add Task Button
│  │     │  └─ Filter/Sort Controls
│  │     │
│  │     ├─ KanbanBoard.tsx
│  │     │  ├─ KanbanColumn (Multiple)
│  │     │  │  ├─ Column Title
│  │     │  │  ├─ Card Count Badge
│  │     │  │  ├─ Drop Zone
│  │     │  │  │
│  │     │  │  └─ KanbanCard (Multiple)
│  │     │  │     ├─ Task Title
│  │     │  │     ├─ Priority Badge
│  │     │  │     ├─ Assignee Avatar
│  │     │  │     ├─ Due Date
│  │     │  │     ├─ Context Menu
│  │     │  │     └─ Drag Handle
│  │     │  │
│  │     │  ├─ CreateTaskDialog.tsx (Modal)
│  │     │  ├─ TaskDetailDrawer.tsx (Full editor)
│  │     │  └─ ProposalInbox.tsx
│  │     │
│  │     └─ KanbanQuickView (In WorkspacePanel)
│  │
│  └─ [Desktop Only] Right Panel Stack
│     │
│     ├─ PanelErrorBoundary (Wrapper)
│     │  │
│     │  ├─ SessionList.tsx
│     │  │  ├─ Panel Header (◆ AGENTS)
│     │  │  ├─ SessionTree.tsx
│     │  │  │  └─ SessionNode (Recursive tree)
│     │  │  │     ├─ Status Indicator
│     │  │  │     ├─ Unread Badge
│     │  │  │     ├─ Busy Spinner
│     │  │  │     ├─ Session Name
│     │  │  │     ├─ Action Menu
│     │  │  │     └─ Nested children
│     │  │  │
│     │  │  ├─ SpawnAgentDialog.tsx (Modal)
│     │  │  │  ├─ Agent Name Input
│     │  │  │  ├─ Parent Selector
│     │  │  │  └─ Create Button
│     │  │  │
│     │  │  ├─ SessionInfoPanel.tsx (Expanded view)
│     │  │  │  ├─ Model Info
│     │  │  │  ├─ Token Usage
│     │  │  │  └─ Context Window
│     │  │  │
│     │  │  └─ Refresh Button
│     │  │
│     │  └─ WorkspacePanel.tsx
│     │     ├─ Panel Header (◆ WORKSPACE)
│     │     ├─ WorkspaceTabs.tsx (Tab bar)
│     │     │  ├─ Brain Icon → MEMORY
│     │     │  ├─ Clock Icon → CRONS
│     │     │  ├─ Columns Icon → TASKS
│     │     │  └─ Settings Icon → CONFIG
│     │     │
│     │     ├─ MemoryTab (Active content)
│     │     │  ├─ MemoryList.tsx
│     │     │  │  ├─ MemoryItem (Multiple)
│     │     │  │  │  ├─ Memory Name
│     │     │  │  │  ├─ Preview
│     │     │  │  │  ├─ Edit Button
│     │     │  │  │  └─ Delete Button
│     │     │  │  │
│     │     │  │  ├─ AddMemoryDialog.tsx (Modal)
│     │     │  │  ├─ MemoryEditor.tsx (Modal)
│     │     │  │  └─ ConfirmDeleteDialog.tsx (Modal)
│     │     │  │
│     │     │  └─ Add Button
│     │     │
│     │     ├─ CronsTab (Active content)
│     │     │  ├─ Cron Table/List
│     │     │  ├─ CronDialog.tsx (Modal)
│     │     │  │  ├─ Cron Expression Input
│     │     │  │  ├─ Timezone Selector
│     │     │  │  ├─ Payload Editor
│     │     │  │  └─ Schedule Picker UI
│     │     │  │
│     │     │  ├─ Add Button
│     │     │  └─ Run History
│     │     │
│     │     ├─ TasksTab (Active content)
│     │     │  └─ KanbanQuickView (Compact view)
│     │     │
│     │     └─ ConfigTab (Active content)
│     │        ├─ Files/Skills Toggle
│     │        ├─ [View: Files] ConfigTab.tsx
│     │        │  ├─ Config Files List
│     │        │  ├─ Environment Variables
│     │        │  └─ Manifest Display
│     │        │
│     │        └─ [View: Skills] SkillsTab.tsx
│     │           ├─ Skills List
│     │           ├─ Install Button
│     │           └─ Uninstall Button
│
├─ StatusBar.tsx (Fixed footer)
│  ├─ Connection Indicator
│  ├─ Session Counter
│  ├─ ContextMeter.tsx
│  │  ├─ Progress Bar
│  │  ├─ Percentage
│  │  └─ Token Count
│  ├─ Sparkline Graph
│  └─ Update Badge
│
├─ [Overlay] SettingsDrawer.tsx (Slide-in from right)
│  ├─ ConnectionSettings.tsx
│  │  ├─ Gateway URL Input
│  │  ├─ Token Input
│  │  └─ Reconnect Button
│  │
│  ├─ AudioSettings.tsx
│  │  ├─ Sound Toggle
│  │  ├─ TTS Provider Select
│  │  ├─ TTS Model Select
│  │  ├─ Voice Selector
│  │  ├─ STT Provider Select
│  │  ├─ STT Input Mode Select
│  │  ├─ Wake Word Toggle
│  │  ├─ VoicePhrasesModal.tsx
│  │  └─ Live Transcription Preview
│  │
│  └─ AppearanceSettings.tsx
│     ├─ Theme Toggle (Dark/Light)
│     ├─ Font Size Slider
│     └─ Font Family Selector
│
├─ [Overlay] CommandPalette.tsx (Keyboard-driven modal)
│  ├─ Search Input
│  └─ Command List
│
├─ [Modal] ConnectDialog.tsx
├─ [Modal] ConfirmDialog.tsx
├─ [Modal] WorkspaceSwitchDialog.tsx
│
└─ Error Boundaries
   ├─ PanelErrorBoundary (Chat)
   ├─ PanelErrorBoundary (File Explorer)
   ├─ PanelErrorBoundary (Sessions)
   ├─ PanelErrorBoundary (Workspace)
   ├─ PanelErrorBoundary (Settings)
   ├─ PanelErrorBoundary (Command Palette)
   └─ ErrorBoundary (Global fallback)
```

---

## Component Dependencies

### Import Chains (Critical Path)

```
App.tsx
├─ useGateway() → GatewayContext
├─ useSessionContext() → SessionContext + useCrons hook
├─ useChat() → ChatContext
├─ useSettings() → SettingsContext
│
└─ Feature Imports:
   ├─ ChatPanel → Chat context + InputBar (voice)
   ├─ FileTreePanel → useOpenFiles hook + Monaco Editor
   ├─ SessionList → useSessionContext
   ├─ WorkspacePanel → useDashboardData hook + useCrons hook
   ├─ KanbanPanel → Kanban context (implicit)
   └─ SettingsDrawer → useSettings context
```

### Data Flow (Unidirectional)

```
Gateway (WebSocket)
    ↓
GatewayContext
    ↓
├─ SessionContext (Agents/Crons)
├─ ChatContext (Messages)
└─ SettingsContext (User Prefs)
    ↓
All Components (via hooks)
```

---

## File Organization Reference

```
~/nerve/src/
├─ App.tsx (794 lines - main orchestrator)
├─ index.css (global styles + Tailwind)
├─ types.ts (shared TypeScript interfaces)
│
├─ components/ (Shared UI)
│  ├─ TopBar.tsx
│  ├─ StatusBar.tsx
│  ├─ ContextMeter.tsx
│  ├─ ResizablePanels.tsx
│  ├─ PanelErrorBoundary.tsx
│  ├─ ErrorBoundary.tsx
│  ├─ ConfirmDialog.tsx
│  ├─ WorkspaceSwitchDialog.tsx
│  ├─ NerveLogo.tsx
│  ├─ UpdateBadge.tsx
│  ├─ ui/ (shadcn primitives)
│  │  ├─ button.tsx
│  │  ├─ card.tsx
│  │  ├─ dialog.tsx
│  │  ├─ input.tsx
│  │  ├─ switch.tsx
│  │  ├─ collapsible.tsx
│  │  ├─ InlineSelect.tsx
│  │  └─ AnimatedNumber.tsx
│  └─ skeletons/ (Loading placeholders)
│
├─ contexts/ (React Context providers)
│  ├─ GatewayContext.tsx
│  ├─ SessionContext.tsx
│  ├─ ChatContext.tsx
│  └─ SettingsContext.tsx
│
├─ hooks/ (Global hooks)
│  ├─ useConnectionManager.ts
│  ├─ useDashboardData.ts
│  ├─ useKeyboardShortcuts.ts
│  └─ useGatewayRestart.ts
│
├─ features/
│
│  ├─ chat/
│  │  ├─ ChatPanel.tsx (Main container)
│  │  ├─ MessageBubble.tsx
│  │  ├─ InputBar.tsx
│  │  ├─ ChatHeader.tsx
│  │  ├─ ToolCallBlock.tsx
│  │  ├─ FileContentView.tsx
│  │  ├─ ImageLightbox.tsx
│  │  ├─ SearchBar.tsx
│  │  ├─ MemoriesSection.tsx
│  │  ├─ DiffView.tsx
│  │  ├─ components/
│  │  │  ├─ ScrollToBottomButton.tsx
│  │  │  ├─ StreamingMessage.tsx
│  │  │  ├─ ProcessingIndicator.tsx
│  │  │  ├─ HeartbeatPulse.tsx
│  │  │  ├─ ThinkingDots.tsx
│  │  │  ├─ ChatHeader.tsx
│  │  │  ├─ ActivityLog.tsx
│  │  │  └─ ToolGroupBlock.tsx
│  │  ├─ operations/ (Data fetching)
│  │  │  └─ loadHistory.ts
│  │  ├─ hooks/
│  │  │  ├─ useMessageSearch.ts
│  │  │  └─ useModelEffort.ts
│  │  ├─ types.ts
│  │  ├─ utils.ts
│  │  └─ ChatPanel.test.tsx
│  │
│  ├─ sessions/
│  │  ├─ SessionList.tsx (Main container)
│  │  ├─ SessionNode.tsx
│  │  ├─ SessionTree.ts (Logic)
│  │  ├─ SessionInfoPanel.tsx
│  │  ├─ SpawnAgentDialog.tsx
│  │  ├─ buildSpawnSubagentMessage.ts
│  │  ├─ sessionKeys.ts (Utilities)
│  │  ├─ statusUtils.ts
│  │  ├─ unreadSessions.ts
│  │  └─ [*.test.tsx] (Tests)
│  │
│  ├─ workspace/
│  │  ├─ WorkspacePanel.tsx (Main container)
│  │  ├─ WorkspaceTabs.tsx (Tab bar)
│  │  ├─ tabs/
│  │  │  ├─ MemoryTab.tsx
│  │  │  ├─ CronsTab.tsx
│  │  │  ├─ ConfigTab.tsx
│  │  │  ├─ SkillsTab.tsx
│  │  │  ├─ CronDialog.tsx
│  │  │  └─ index.ts
│  │  ├─ hooks/
│  │  │  ├─ useCrons.ts (Data management)
│  │  │  └─ [others].ts
│  │  ├─ workspaceScope.ts (Utilities)
│  │  ├─ workspaceSwitchGuard.ts
│  │  ├─ persistedDrafts.ts
│  │  └─ [*.test.tsx]
│  │
│  ├─ file-browser/
│  │  ├─ FileTreePanel.tsx (Main container)
│  │  ├─ FileTreeNode.tsx
│  │  ├─ EditorTabBar.tsx
│  │  ├─ EditorTab.tsx
│  │  ├─ TabbedContentArea.tsx
│  │  ├─ FileEditor.tsx
│  │  ├─ ImageViewer.tsx
│  │  ├─ editorTheme.ts
│  │  ├─ utils/
│  │  │  ├─ fileIcons.tsx
│  │  │  ├─ fileTypes.ts
│  │  │  └─ languageMap.ts
│  │  ├─ hooks/
│  │  │  ├─ useOpenFiles.ts
│  │  │  └─ useFileTree.ts
│  │  ├─ types.ts
│  │  ├─ index.ts (Barrel export)
│  │  └─ [*.test.tsx]
│  │
│  ├─ kanban/
│  │  ├─ KanbanPanel.tsx (Main container)
│  │  ├─ KanbanBoard.tsx
│  │  ├─ KanbanColumn.tsx
│  │  ├─ KanbanCard.tsx
│  │  ├─ KanbanHeader.tsx
│  │  ├─ TaskDetailDrawer.tsx
│  │  ├─ CreateTaskDialog.tsx
│  │  ├─ KanbanQuickView.tsx
│  │  ├─ ProposalInbox.tsx
│  │  ├─ lib/ (Utilities)
│  │  ├─ hooks/
│  │  ├─ types.ts
│  │  ├─ tone.ts
│  │  └─ index.ts
│  │
│  ├─ settings/
│  │  ├─ SettingsDrawer.tsx (Main)
│  │  ├─ ConnectionSettings.tsx
│  │  ├─ AudioSettings.tsx
│  │  ├─ AppearanceSettings.tsx
│  │  ├─ VoicePhrasesModal.tsx
│  │  ├─ audioSettingsUtils.ts
│  │  └─ [*.test.tsx]
│  │
│  ├─ dashboard/
│  │  ├─ MemoryList.tsx
│  │  ├─ TokenUsage.tsx
│  │  ├─ useLimits.ts
│  │  └─ [*.test.tsx]
│  │
│  ├─ memory/
│  │  ├─ AddMemoryDialog.tsx
│  │  ├─ MemoryEditor.tsx
│  │  ├─ MemoryItem.tsx
│  │  ├─ ConfirmDeleteDialog.tsx
│  │  ├─ hooks/
│  │  └─ index.ts
│  │
│  ├─ command-palette/
│  │  ├─ CommandPalette.tsx (Main)
│  │  └─ commands.ts (Definitions)
│  │
│  ├─ connect/
│  │  └─ ConnectDialog.tsx
│  │
│  ├─ activity/
│  │  ├─ EventLog.tsx
│  │  └─ AgentLog.tsx
│  │
│  ├─ charts/
│  │  ├─ InlineChart.tsx
│  │  ├─ LightweightChart.tsx
│  │  ├─ TradingViewWidget.tsx
│  │  ├─ extractCharts.ts
│  │  └─ [*.test.tsx]
│  │
│  ├─ voice/
│  │  └─ Voice input components
│  │
│  ├─ tts/
│  │  ├─ useTTS.ts
│  │  ├─ useTTSConfig.ts
│  │  └─ [*.test.tsx]
│  │
│  ├─ markdown/
│  │  └─ Markdown rendering
│  │
│  └─ auth/
│     └─ Authentication components
│
├─ lib/
│  └─ constants.ts (e.g., getContextLimit)
│
└─ utils/
   └─ General utilities
```

---

## Quick Lookup Table

| Want to... | File | Component |
|---|---|---|
| Add a message to chat | `src/features/chat/ChatPanel.tsx` | `<ChatPanel />` |
| Modify tab layout | `src/features/workspace/WorkspaceTabs.tsx` | `<WorkspaceTabs />` |
| Change editor theme | `src/features/file-browser/editorTheme.ts` | `editorTheme` config |
| Add a keyboard shortcut | `src/hooks/useKeyboardShortcuts.ts` | `useKeyboardShortcuts` |
| Customize error display | `src/components/PanelErrorBoundary.tsx` | `<PanelErrorBoundary />` |
| Modify status bar | `src/components/StatusBar.tsx` | `<StatusBar />` |
| Add a cron job UI | `src/features/workspace/tabs/CronDialog.tsx` | `<CronDialog />` |
| Change color scheme | `src/index.css` | Tailwind config + CSS vars |
| Add mobile drawer | `src/App.tsx` | Mobile layout section |
| Customize panel rounded corners | `src/index.css` | `.shell-panel` class |

---

**Generated:** 2026-04-05  
**Document Version:** 1.0  
**Last Updated:** Design review completion
