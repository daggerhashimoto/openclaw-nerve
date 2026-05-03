# Nerve Theme Overhaul — Implementation Summary

## Goal
Make the Nerve UI easily modifiable with:
1. CSS variable–based theming (every color, font, spacing, shadow, etc. controllable)
2. Ability to add more chat panels (Deck/multi-column layout)
3. CSS template support for colors, fonts, spacing
4. Visual theme editor (live-editing all CSS variables)
5. Parity with OpenClaw WebUI appearance controls

## Architecture

### Layer 1: CSS Custom Properties (foundation)
**Files:**
- `src/styles/foundation.css` — all CSS variables in `:root`, organized by concern
- `src/styles/index.css` — Tailwind v4 + Nerve custom utilities

**What changed:**
- Extracted all hardcoded colors/sizes into `--color-*`, `--nerve-*`, `--shell-*`, `--panel-*`, `--deck-*` variables
- Added deck layout variables for multi-column support
- All components now reference variables, not raw values

### Layer 2: Theme Schema (type-safe themes)
**Files:**
- `src/lib/theme-schema.ts` — TypeScript types for themes, validation, normalization

**Key types:**
- `NerveTheme` — full theme with `name`, `label`, `colors` (CSS property map), optional `hljsTheme`, `source`
- `VariableSpec` — metadata for each CSS variable (property, label, group, type, default, description, derived)
- `VariableGroup` — 16 groups for editor organization
- `LayoutTemplate` — layout template with `name`, `label`, `description`, `overrides`
- `ThemeComposition` — a color theme + optional layout template
- `TweakcnTheme` — tweakcn-compatible format for import
- `ExtendedThemeName` = `ThemeName | 'imported'`

**Key functions:**
- `validateTheme()` — validates + fills defaults, returns missing variables
- `normalizeThemeColors()` — normalizes hex colors, ensures `--color-X` ↔ `--X` dual-namespace
- `parseTweakcnInput()` — parses URL, ID, or JSON input for theme import
- `mapTweakcnColors()` — maps tweakcn color tokens to Nerve CSS variables
- `applyNerveTheme()` — applies a NerveTheme to `:root` (defined in themes.ts)
- `themeToCSS()` — converts NerveTheme to CSS string

### Layer 3: Extended Themes (built-in + imported)
**Files:**
- `src/lib/themes.ts` — 14 built-in theme definitions + apply/import functions

**Built-in themes:** midnight, light, phosphor, dracula, nord, solarized-dark, catppuccin-mocha, tokyo-night, gruvbox-dark, one-dark, monokai, ayu-dark, rose-pine, monochrome

**Each theme exports full `colors` record** (70+ variables per theme) including:
- Core semantic colors (background, foreground, card, primary, secondary, muted, accent, destructive, border, input, ring)
- Sidebar colors (sidebar, sidebar-foreground, sidebar-primary, etc.)
- Chart colors (chart-1 through chart-5)
- Message colors (message-user, message-assistant, message-system)
- Status colors (green, red, orange, purple, info)
- Scrollbar colors

**Key functions:**
- `applyTheme(themeName, layoutOverrides?)` — applies a built-in theme + optional layout overrides to `:root`, also swaps hljs stylesheet
- `applyImportedTheme(colors)` — applies imported/custom theme colors to `:root`
- `applyLayoutVariables(overrides)` — applies layout template variables
- `clearLayoutVariables(allLayoutKeys)` — removes previously applied layout variables
- Dual-namespace: setting `--color-primary` also sets `--primary`, and vice versa

### Layer 4: Layout Templates
**Files:**
- `src/lib/layout-templates.ts` — preset layout configurations

**Templates:**
- `default` — standard Nerve layout (empty overrides, uses foundation.css defaults)
- `compact` — tighter spacing, smaller radii, dense information layout
- `comfortable` — generous spacing, larger radii, relaxed feel
- `monospace` — mono font everywhere, terminal aesthetic
- `editor` — optimized for code viewing, wider chat area, larger code blocks
- `high-contrast` — WCAG AAA compliant, maximum readability
- `glassmorphism` — translucent panels, blur effects, soft shadows

**Key functions:**
- `composeWithLayout(themeColors, layoutName)` — merges layout overrides onto theme colors
- `applyLayoutTemplate(templateName)` — applies/removes layout CSS variables to `:root`, tracking which vars were set so they can be cleanly removed on switch

### Layer 5: Variable Specs (editor metadata)
**Files:**
- `src/lib/variable-specs.ts` — registry of all editable CSS variables

**16 groups with 100+ specs:**
- Brand Colors, Surfaces, Text & Content, Status & State, Sidebar, Charts, Messages, Components
- Typography, Spacing, Borders & Radii, Shadows, Animation, Layout, Deck Layout, Code Editor

**Spec types:** `color`, `length`, `font`, `shadow`, `easing`, `duration`, `ratio`

**Key exports:**
- `VARIABLE_SPECS` — full array of all specs
- `GROUP_META` — label + icon for each group
- `getSpecsByGroup()` — returns specs organized by VariableGroup
- `getSpecByProperty(property)` — lookup by CSS variable name
- `isPlainColor(value)` — checks if a value is a plain hex/rgb/hsl color (vs derived)

### Layer 6: Visual Theme Editor
**Files:**
- `src/features/settings/ThemeEditorPanel.tsx` — the main editor component

**Features:**
- Collapsible sections per group, with override count badges
- Native `<input type="color">` for color variables
- Text input for length, font, shadow, easing, duration types
- Derived variable indicator (shows `var(--primary)` etc.)
- Search/filter across all variables
- Per-variable reset to default
- Reset all overrides
- Export as CSS or JSON (copied to clipboard)
- Persistence to localStorage (`nerve:theme:overrides`)
- Live preview (changes apply immediately via `style.setProperty`)
- Collapsed group state persisted to localStorage (`nerve:theme:editor-expanded-groups`)

**Types:**
- `ThemeOverrides` — `Record<string, string>` mapping CSS properties to override values
- `loadThemeOverrides()` / `saveThemeOverrides()` — localStorage helpers

### Layer 7: Settings Integration
**Files:**
- `src/contexts/SettingsContext.tsx` — added `themeOverrides`, `setThemeOverride`, `resetThemeOverride`, `resetAllThemeOverrides`, plus layout template, imported theme, and high contrast state
- `src/features/settings/AppearanceSettings.tsx` — full appearance settings panel

**SettingsContext additions:**
- `layoutTemplate` / `setLayoutTemplate` — layout template selection (persisted to localStorage)
- `importedTheme` / `setImportedTheme` — imported/custom theme (persisted via theme-io)
- `highContrast` / `setHighContrast` — high contrast toggle (sets `data-high-contrast` attribute)
- `themeOverrides` / `setThemeOverride` / `resetThemeOverride` / `resetAllThemeOverrides` — per-variable overrides

**AppearanceSettings features:**
- Theme selector (14 built-in themes)
- Layout template selector (default, compact, comfortable, monospace, editor, high-contrast, glassmorphism)
- High contrast toggle
- Chat layout mode toggle (single / deck)
- Font selector, font size, editor font size
- Theme import (tweakcn URL, JSON, or CSS)
- Theme export (CSS or JSON)
- Collapsible Theme Editor with live variable editing

### Layer 8: Deck/Multi-Column Layout
**Files:**
- `src/contexts/DeckContext.tsx` — DeckProvider with layout mode, column configs, add/remove/reorder/resize/toggle/equalize
- `src/contexts/SessionScope.tsx` — SessionScope component that overrides SessionContext for a subtree, enabling independent chat sessions per column
- `src/features/chat/DeckAwareChatWrapper.tsx` — switches between single ChatPanel and multi-column DeckLayout based on layoutMode
- `src/features/chat/DeckLayout.tsx` — multi-column layout with resizable columns and add-column button
- `src/features/chat/ChatColumn.tsx` — individual column wrapper with header (label, agent name, close button)
- `src/features/chat/AddColumnDialog.tsx` — modal for selecting a session to add as a new column
- `src/features/chat/EmptyChatState.tsx` — empty state with quick-action cards (command palette, new session, refresh, settings)

**Layout modes:** `single` (default) and `deck`

**DeckContext API:**
- `layoutMode` / `setLayoutMode` — toggle between single and deck
- `columns` — array of `DeckColumn` objects (id, sessionKey, agentId, flex)
- `activeColumnId` / `setActiveColumn` — which column is active
- `addColumn(sessionKey, agentId?)` — add a new column
- `removeColumn(id)` — remove a column by ID
- `reorderColumns(fromIdx, toIdx)` — drag-reorder columns
- `resizeColumn(leftId, rightId, deltaRatio)` — resize adjacent columns via drag
- `toggleColumn(sessionKey, agentId?)` — add if absent, remove if present (returns 'added' | 'removed')
- `ensureColumn(sessionKey, agentId?)` — auto-add a column if deck has none
- `equalizeColumns()` — reset all columns to equal flex

**SessionScope:** wraps a React subtree with an overridden `SessionContext.Provider` that fixes `currentSession` to a specific session key, so each deck column gets its own independent ChatProvider. Re-uses the same `SessionContext` object so downstream consumers work without changes.

**DeckAwareChatWrapper:** in single mode renders the provided `singleChat` node (the normal ChatPanel). In deck mode, renders a `DeckLayout` where each column is wrapped in `SessionScope` + `ChatProvider` for full independence. Auto-ensures at least one column exists when switching to deck mode.

**Sidebar→Deck wiring in App.tsx:**
- When `layoutMode === 'deck'`, the sidebar session list uses `toggleColumn(sessionKey, agentId)` instead of `setCurrentSession(key)` — clicking an agent toggles its column in/out of the deck
- When `layoutMode === 'single'`, normal session switching with workspace-switch guard applies

**Persistence:**
- Layout mode saved to `localStorage` key `nerve:layout-mode`
- Column configs saved to `localStorage` key `nerve:deck-columns`

### Layer 9: Gateway Theme Bridge
**Files:**
- `src/lib/gateway-theme.ts` — reads gateway config and applies as CSS overrides

**Features:**
- `GatewayThemeConfig` — interface for `seamColor`, `assistantName`, `assistantAvatar`
- `applyGatewayThemeOverrides(config)` — applies seam color as `--color-ring` / `--ring` override
- `fetchGatewayThemeConfig()` — fetches from `/api/config/public` (no auth needed)
- Gateway theme is applied only when no imported theme is active (imported themes take priority)

### Layer 10: Import/Export
**Files:**
- `src/lib/theme-io.ts` — save/load/import themes from file, URL, or tweakcn registry

**Supported formats:**
- CSS (`.css` files with `:root` variables) — via `parseCSSSnippet()` and `importFromCSS()`
- JSON (NerveTheme objects) — via `exportAsJSON()`
- tweakcn registry fetch — via `fetchTweakcnTheme(input)` (URL, ID, or raw JSON)
- Export as CSS — `exportAsCSS(theme)` generates `:root { ... }` block
- Export as JSON — `exportAsJSON(theme)` generates pretty-printed JSON
- Export as tweakcn-compatible JSON — `exportAsTweakcn(theme)` reverses the mapping

**Browser-local persistence:**
- `saveImportedTheme(theme)` / `loadImportedTheme()` — single-slot localStorage storage
- `clearImportedTheme()` — removes imported theme
- `saveLayoutTemplate(name)` / `loadLayoutTemplate()` — layout template preference

## File Manifest

### New files created:
```
src/styles/foundation.css
src/lib/theme-schema.ts
src/lib/variable-specs.ts
src/lib/layout-templates.ts
src/lib/gateway-theme.ts
src/lib/theme-io.ts
src/contexts/DeckContext.tsx
src/contexts/SessionScope.tsx
src/features/chat/DeckAwareChatWrapper.tsx
src/features/chat/DeckLayout.tsx
src/features/chat/ChatColumn.tsx
src/features/chat/AddColumnDialog.tsx
src/features/chat/EmptyChatState.tsx
src/features/settings/ThemeEditorPanel.tsx
```

### Modified files:
```
src/styles/index.css                — added Tailwind v4 + Nerve custom utilities
src/lib/themes.ts                   — extended with full color maps (70+ vars per theme), imported theme support, layout variable helpers
src/contexts/SettingsContext.tsx     — themeOverrides state + setters, layoutTemplate/importedTheme/highContrast state, gateway theme bridge
src/features/settings/AppearanceSettings.tsx — full appearance panel with theme/layout/font/import/editor controls + deck mode toggle
src/App.tsx                         — DeckProvider wrapper, DeckAwareChatWrapper integration, sidebar→deck toggleColumn wiring
```

## Build Status
✅ TypeScript: no errors
✅ Vite build: successful