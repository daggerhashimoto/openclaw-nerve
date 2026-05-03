# Deck Mode

> Multi-column chat layout for simultaneous, independent chat sessions side-by-side.

---

## Overview

Deck Mode transforms the Nerve chat interface from a single-session view into a multi-column layout where you can chat with multiple agents (or multiple sessions) simultaneously. Each column is a fully independent chat — its own messages, input bar, streaming state, and scroll position — displayed side-by-side so you can monitor and interact with several conversations at once.

**Key properties:**

- Up to **6 columns** at once
- Each column has its own `ChatProvider` / session context — no shared chat state
- The global session list remains shared; only `currentSession` is scoped per column
- Layout (mode + column list) persists to `localStorage` across reloads
- Columns can be **resized** by dragging the gutter between them
- Toggle between `single` and `deck` layout modes at any time

---

## Architecture

### Component Hierarchy

```
AuthGate
 └─ GatewayProvider
     └─ SettingsProvider
         └─ SessionProvider          ← global session list
             └─ ChatProvider          ← global chat state (used in single mode)
                 └─ DeckProvider     ← layout state (mode, columns, active)
                     └─ App
                         └─ DeckAwareChatWrapper
                             ├─ [single mode]  → ChatPanel (existing)
                             └─ [deck mode]    → DeckLayout
                                                    ├─ ChatColumn → SessionScope → ChatProvider → ChatPanel
                                                    ├─ ChatColumn → SessionScope → ChatProvider → ChatPanel
                                                    ├─ … (resize gutters between)
                                                    └─ [+] button (→ AddColumnDialog)
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ DeckContext                                                      │
│  layoutMode: 'single' | 'deck'                                  │
│  columns: DeckColumn[]                                          │
│  activeColumnId: string | null                                  │
│  actions: addColumn, removeColumn, toggleColumn, reorderColumns,│
│           resizeColumn, ensureColumn, equalizeColumns            │
│  persistence: localStorage                                      │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ DeckAwareChatWrapper                                             │
│  Reads layoutMode from DeckContext                               │
│  If 'single' → renders the existing ChatPanel directly           │
│  If 'deck'   → renders DeckLayout + AddColumnDialog             │
│  Ensures at least one column exists when switching to deck       │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ DeckLayout                                                       │
│  Flex container rendering columns side-by-side                  │
│  Each column: flex <col.flex> 1 0%                              │
│  Resize handles between adjacent columns                         │
│  Add-column button (visible when columns < 6)                    │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼ per column
┌─────────────────────────────────────────────────────────────────┐
│ ChatColumn                                                       │
│  Header: session label, agent name, close (×) button            │
│  Body:   active → full ChatPanel, inactive → same ChatPanel     │
│          (both use SessionScope → scoped ChatProvider)          │
│  Active/inactive styling: bg-background vs bg-muted/30          │
└────────────┬────────────────────────────────────────────────────┘
             │ wraps each column
┌─────────────────────────────────────────────────────────────────┐
│ SessionScope (per column)                                        │
│  Overrides currentSession for a React subtree                   │
│  Reads parent SessionContext, swaps currentSession to column's  │
│  sessionKey, re-provides SessionContext.Provider                │
│  setCurrentSession → no-op (deck columns don't change session)  │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│ ChatProvider (scoped)                                           │
│  Each column gets its own ChatProvider instance                  │
│  Fully independent chat state: messages, stream, input, etc.    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### DeckContext (`src/contexts/DeckContext.tsx`)

The central state manager for Deck Mode. Provides:

| Export | Description |
|--------|-------------|
| `LayoutMode` | Type: `'single' \| 'deck'` |
| `DeckColumn` | Interface: `{ id: string, sessionKey: string, agentId?: string, flex: number }` |
| `DeckProvider` | Context provider wrapping the app |
| `useDeck()` | Hook returning the full context value |

**Context value shape:**

```typescript
interface DeckContextValue {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  columns: DeckColumn[];
  activeColumnId: string | null;
  setActiveColumn: (id: string) => void;
  addColumn: (sessionKey: string, agentId?: string) => void;
  removeColumn: (id: string) => void;
  reorderColumns: (fromIdx: number, toIdx: number) => void;
  resizeColumn: (leftId: string, rightId: string, deltaRatio: number) => void;
  toggleColumn: (sessionKey: string, agentId?: string) => 'added' | 'removed';
  ensureColumn: (sessionKey: string, agentId?: string) => void;
  equalizeColumns: () => void;
}
```

**Key behaviors:**

- **Persistence**: `layoutMode` saved to `nerve:layout-mode`, columns to `nerve:deck-columns` (both in `localStorage`)
- **Auto-equalize**: Adding or removing a column calls `equalizeFlex()` internally, resetting all `flex` values to `1`
- **Minimum flex**: `MIN_COLUMN_FLEX = 0.3` — columns can't shrink below ~30% of average width
- **Auto-active**: If `activeColumnId` is null but columns exist, the first column becomes active
- **Column IDs**: Generated as `col-{timestamp}-{counter}` for uniqueness

### SessionScope (`src/contexts/SessionScope.tsx`)

A thin provider that overrides `currentSession` for a React subtree:

```tsx
<SessionScope sessionKey="agent/assistant">
  <ChatProvider>      {/* uses the scoped session */}
    <ChatPanel />     {/* fully independent chat */}
  </ChatProvider>
</SessionScope>
```

- Reads the parent `SessionContext` to preserve the session list, gateway state, etc.
- Overrides only `currentSession` (set to the column's `sessionKey`) and `setCurrentSession` (no-op)
- Re-provides `SessionContext.Provider` with the overridden value
- All downstream consumers (`ChatContext`, `ChatPanel`, etc.) work without changes

### DeckAwareChatWrapper (`src/features/chat/DeckAwareChatWrapper.tsx`)

The switch point between single and deck layouts:

| Mode | Renders |
|------|---------|
| `single` | The `singleChat` prop directly (the existing `ChatPanel`) |
| `deck` | `DeckLayout` + `AddColumnDialog` |

**Responsibilities:**

- When switching to deck mode with no columns, calls `ensureColumn(currentSessionKey)` to seed the first column
- Each column is rendered as: `SessionScope → ChatProvider → ScopedChatPanel`
- `ScopedChatPanel` manages its own local search state (so opening search in one column doesn't affect others)
- Passes through action handlers: `onOpenCommandPalette`, `onOpenSearch`, `onRefreshSessions`, `onOpenSettings`, `onNewSession`

### DeckLayout (`src/features/chat/DeckLayout.tsx`)

Flex-based multi-column layout:

- Each column gets `flex: <col.flex> 1 0%` — they share space proportionally
- Resize handles between adjacent columns (1.5px wide dividers, `cursor-col-resize`)
- An add-column "+" button on the right edge when `columns.length < 6`
- When columns are empty, shows a placeholder "Add a chat column" button
- Resize uses **incremental delta tracking**: each `mousemove` computes delta from the last position, multiplied by `SENSITIVITY = 0.002` (flex-ratio change per pixel)

### ChatColumn (`src/features/chat/ChatColumn.tsx`)

Column wrapper component:

```
┌──────────────────────────┐
│ ● Label        Agent Name ✕│  ← Header (fixed, never scrolls)
├──────────────────────────┤
│                          │
│   Chat content           │  ← Body (flex-1, scrolls independently)
│   (ChatPanel)            │
│                          │
└──────────────────────────┘
```

- **Header**: session label (truncated), agent name (truncated, smaller text), close button
- **Active state**: `bg-background`, no click handler (already active)
- **Inactive state**: `bg-muted/30`, click-to-activate, `cursor-pointer`
- Keyboard accessible: `Enter`/`Space` activates inactive columns
- `role="tab"`, `aria-selected`, `aria-label` for accessibility

### AddColumnDialog (`src/features/chat/AddColumnDialog.tsx`)

Modal for selecting a session to add as a new column:

- Full-screen backdrop with centered dialog
- Search/filter input with auto-focus
- Deduplicates: sessions already in the deck are excluded
- Each session shows: label, session key, agent name
- Click a session → `addColumn()` → close dialog
- Empty states: "No sessions available" or "All sessions already in deck or no matches"

### EmptyChatState (`src/features/chat/EmptyChatState.tsx`)

Quick-action cards displayed when a chat has no messages:

```
         🗨️
     Agent Name
  Type a message below, or
  pick a quick action.

  ┌─────────────┐  ┌─────────────┐
  │ ⌘K Command  │  │ + New       │
  │   Palette   │  │   Session   │
  └─────────────┘  └─────────────┘
  ┌─────────────┐  ┌─────────────┐
  │ ↻ Refresh   │  │ ⚙ Settings  │
  │   Sessions  │  │             │
  └─────────────┘  └─────────────┘
```

- Default actions: Command Palette (`⌘K`), New Session, Refresh Sessions, Settings
- Each action card is keyboard-accessible with `Enter`/`Space`
- Responsive grid: 1 column on small screens, 2 on `sm+`
- Only renders actions whose callbacks are provided

---

## How It Works

Each deck column achieves full independence through **scoped context providers**:

```
Global SessionProvider (session list shared)
  └─ Global ChatProvider (only used in single mode)
      └─ DeckProvider (layout state)
          └─ DeckAwareChatWrapper
              └─ DeckLayout
                  ├─ ChatColumn
                  │   └─ SessionScope sessionKey="agent/alice"
                  │       └─ ChatProvider (Alice's chat)
                  │           └─ ScopedChatPanel → ChatPanel
                  │
                  ├─ ChatColumn
                  │   └─ SessionScope sessionKey="agent/bob"
                  │       └─ ChatProvider (Bob's chat)
                  │           └─ ScopedChatPanel → ChatPanel
                  └─ ...
```

1. **SessionScope** intercepts `SessionContext` and overrides `currentSession` to the column's session key
2. **ChatProvider** inside the scope creates a fresh chat state for that session
3. **ChatPanel** renders normally — it doesn't know it's in a deck

This means each column's messages, streaming state, input history, and scroll position are completely independent. The global session list (which sessions exist) is shared, but which session is "current" is scoped per column.

---

## Layout Modes

| Mode | Key | Behavior |
|------|-----|----------|
| **Single** | `'single'` | Default Nerve layout — one ChatPanel, sidebar session switching |
| **Deck** | `'deck'` | Multi-column layout — side-by-side ChatPanels, each independent |

- Persisted to `localStorage` key `nerve:layout-mode`
- Default is `'single'`
- Toggle via `DeckContext.setLayoutMode()`
- Invalid values fall back to `'single'`

---

## Column Lifecycle

### Adding a Column

**From the sidebar** (App.tsx `handleSessionChange`):

When in deck mode, clicking a session in the sidebar calls `toggleColumn(key, agentId)`:
- If the session is **not** in the deck → adds it as a new column
- If the session **is** already in the deck → removes its column

**From AddColumnDialog**:

The "+" button on the right edge of the deck opens a modal listing available sessions (excluding those already in the deck). Selecting one calls `addColumn(sessionKey, agentId)`.

**Auto-seeding** (`ensureColumn`):

When switching to deck mode with no columns, `DeckAwareChatWrapper` calls `ensureColumn(currentSessionKey)` to create the first column from the current session.

**Column limits**: Maximum of 6 columns. The add-column button is hidden when at capacity.

### Removing a Column

- Click the **×** button in the column header → `removeColumn(id)`
- Or click the same session in the sidebar → `toggleColumn` removes it
- If the removed column was active, `activeColumnId` resets to `null` (auto-picks first column)
- Remaining columns are equalized to equal flex

### Resizing Columns

- **Drag handle**: A 1.5px divider between adjacent columns with `cursor-col-resize`
- **Incremental tracking**: Each `mousemove` computes `deltaX = currentX - lastX`, then `deltaRatio = deltaX × 0.002`
- `resizeColumn(leftId, rightId, deltaRatio)` transfers flex proportion: left gains, right shrinks (or vice versa)
- **Minimum constraint**: No column can shrink below `MIN_COLUMN_FLEX = 0.3` (~30% of average)
- After manual resize, columns have custom flex proportions; call `equalizeColumns()` to reset to equal widths

### Reordering Columns

`reorderColumns(fromIdx, toIdx)` is available in the context but not currently wired to UI drag-and-drop. The `ChatColumn` component has an `onDragStart` prop (with `GripVertical` icon) prepared for future implementation.

---

## CSS Variables

Deck Mode uses custom properties for layout dimensions, integrated with the Nerve theme system:

| Variable | Default | Purpose |
|----------|---------|---------|
| `--deck-header-height` | `36px` | Height of each column's header bar |
| `--deck-gutter-width` | `6px` | Width of the resize handle between columns |
| `--deck-gap` | `2px` | Gap between deck elements |
| `--deck-column-min-width` | `320px` | Minimum width a column can shrink to |
| `--deck-accent-width` | `3px` | Width of the colored accent stripe per column |
| `--deck-accent-1` through `--deck-accent-7` | Blue, Green, Purple, Orange, Red, Teal, Yellow | Per-column accent colors |

### Layout Template Overrides

The three built-in layout templates adjust deck variables:

| Template | `--deck-header-height` | `--deck-gutter-width` |
|----------|----------------------|-----------------------|
| **Compact** | `32px` | `3px` |
| **Comfortable** | `44px` | `8px` |
| **(default)** | `36px` | `6px` |

These are defined in `src/lib/layout-templates.ts` alongside other spacing/font overrides and applied through the theme system.

---

## Integration Points

### App.tsx — Sidebar → Deck Wiring

In `App.tsx`, the `handleSessionChange` callback is the bridge between the sidebar and Deck Mode:

```typescript
const { layoutMode, toggleColumn } = useDeck();

const handleSessionChange = useCallback((key: string) => {
  if (layoutMode === 'deck') {
    // In deck mode: toggle the session as a column
    toggleColumn(key, getWorkspaceAgentId(key));
    return;
  }
  // In single mode: normal session switch
  void requestWorkspaceTransition(key, getWorkspaceSwitchLabel(key), async () => {
    setCurrentSession(key);
  });
}, [toggleColumn, getWorkspaceAgentId, getWorkspaceSwitchLabel, layoutMode, ...]);
```

This means:
- **Single mode**: Clicking a sidebar session switches the active chat (existing behavior)
- **Deck mode**: Clicking a sidebar session toggles it as a column (add if absent, remove if present)

### Provider Nesting

The provider order in `AuthGate.tsx` is:

```tsx
<GatewayProvider>
  <SettingsProvider>
    <SessionProvider>
      <ChatProvider>
        <DeckProvider>
          <App />
        </DeckProvider>
      </ChatProvider>
    </SessionProvider>
  </SettingsProvider>
</GatewayProvider>
```

Key points:
- `DeckProvider` sits **inside** the global `ChatProvider` and `SessionProvider`
- In deck mode, each column creates its own `SessionScope → ChatProvider` pair inside `DeckAwareChatWrapper`
- The global `ChatProvider` is only used in single mode; in deck mode, each column's scoped provider takes over

### Layout Template Integration

Deck CSS variables are treated as first-class layout properties. They appear in:
- `src/lib/variable-specs.ts` — registered as theme-editable variables in the `deck-layout` group
- `src/lib/layout-templates.ts` — overridden by compact/comfortable/etc. templates
- `src/lib/theme-io.ts` — excluded from generic custom-variable serialization (preserved as structural)
- `src/lib/theme-schema.ts` — excluded from generic schema validation (preserved as structural)