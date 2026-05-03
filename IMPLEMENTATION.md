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
- `NerveTheme` — full theme with `name`, `colors`, `typography`, `spacing`, `borders`, `shadows`, `animation`, `layout`, `deck`, `editor` sections
- `VariableSpec` — metadata for each CSS variable (property, label, group, type, default)
- `VariableGroup` — 16 groups for editor organization

**Key functions:**
- `validateTheme()` — validates + fills defaults
- `normalizeThemeColors()` — normalizes hex colors
- `applyNerveTheme()` — applies a NerveTheme to `:root`
- `themeToCSS()` — converts NerveTheme to CSS string

### Layer 3: Extended Themes (built-in + imported)
**Files:**
- `src/lib/themes.ts` — extended theme definitions with all CSS variables (not just `colors`)

**What changed:**
- Themes now export full `colors` record (70+ variables per theme)
- Added type: `ExtendedThemeName` = `ThemeName | 'imported'`
- `applyTheme()` handles both compact and full theme formats
- Import/export of complete themes via `theme-io.ts`

### Layer 4: Layout Templates
**Files:**
- `src/lib/layout-templates.ts` — preset layout configurations

**Templates:**
- `default` — standard Nerve layout
- `compact` — tighter spacing for information density
- `spacious` — relaxed for readability
- `deck-2col` / `deck-3col` — multi-column chat layouts
- `wide` — max-width chat for ultra-wide monitors
- `mobile` — touch-friendly with larger tap targets

### Layer 5: Variable Specs (editor metadata)
**Files:**
- `src/lib/variable-specs.ts` — registry of all editable CSS variables

**16 groups with 100+ specs:**
- Brand Colors, Surfaces, Text & Content, Status & State, Sidebar, Charts, Messages, Components
- Typography, Spacing, Borders & Radii, Shadows, Animation, Layout, Deck Layout, Code Editor

**Spec types:** `color`, `length`, `font`, `shadow`, `easing`, `duration`, `ratio`

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
- Persistence to localStorage
- Live preview (changes apply immediately via `style.setProperty`)

### Layer 7: Settings Integration
**Files:**
- `src/contexts/SettingsContext.tsx` — added `themeOverrides`, `setThemeOverride`, `resetThemeOverride`, `resetAllThemeOverrides`
- `src/features/settings/AppearanceSettings.tsx` — collapsible Theme Editor section

### Layer 8: Deck/Multi-Column Layout
**Files:**
- `src/contexts/DeckContext.tsx` — DeckContext with layout mode, column configs, add/remove/reorder
- `src/components/deck/DeckShell.tsx` — main multi-column layout shell with resizable columns
- `src/components/deck/DeckColumn.tsx` — individual column wrapper with accent stripe
- `src/components/deck/ResizeHandle.tsx` — drag-to-resize between columns

**Layout modes:** `single` (default Nerve), `deck-2`, `deck-3`, `deck-freeform`

**Features:**
- Per-column accent color (7 preset colors via `--deck-accent-1` through `--deck-accent-7`)
- Resizable columns with drag handles
- Column header with session selector
- Add/remove columns
- Keyboard navigation between columns

### Layer 9: Import/Export
**Files:**
- `src/lib/theme-io.ts` — save/load/import themes from file, URL, or tweakcn registry

**Supported formats:**
- CSS (`.css` files with `:root` variables)
- JSON (NerveTheme objects)
- tweakcn registry fetch
- Export as CSS or JSON

## File Manifest

### New files created:
```
src/styles/foundation.css
src/lib/theme-schema.ts
src/lib/variable-specs.ts
src/lib/layout-templates.ts
src/lib/gateway-theme.ts
src/contexts/DeckContext.tsx
src/components/deck/DeckShell.tsx
src/components/deck/DeckColumn.tsx
src/components/deck/ResizeHandle.tsx
src/features/settings/ThemeEditorPanel.tsx
```

### Modified files:
```
src/styles/index.css         — added Tailwind v4 + Nerve custom utilities
src/lib/themes.ts            — extended with full color maps, imported theme support
src/lib/theme-io.ts          — import/export for full NerveTheme, layout templates
src/contexts/SettingsContext.tsx — themeOverrides state + setters
src/features/settings/AppearanceSettings.tsx — Theme Editor collapsible section
```

## Build Status
✅ TypeScript: no errors
✅ Vite build: successful