# Nerve Theme System

Nerve's theme system is built on CSS custom properties with full runtime switching, a visual editor, import/export, and independent layout templates. Everything is driven by variables on `:root` — themes never touch component internals directly.

---

## Table of Contents

1. [CSS Custom Properties System](#1-css-custom-properties-system)
2. [Theme Schema](#2-theme-schema)
3. [Built-in Themes](#3-built-in-themes)
4. [Layout Templates](#4-layout-templates)
5. [Variable Specs](#5-variable-specs)
6. [Visual Theme Editor](#6-visual-theme-editor)
7. [Settings Integration](#7-settings-integration)
8. [Import / Export](#8-import--export)
9. [Quick Start](#9-quick-start)

---

## 1. CSS Custom Properties System

**Source:** `src/styles/foundation.css`

All theming runs through CSS custom properties set on `:root`. Runtime switching works by overriding these via `document.documentElement.style.setProperty()`.

### Naming Conventions

| Prefix | Namespace | Purpose | Example |
|---|---|---|---|
| `--color-*` | shadcn/ui color tokens | Semantic color tokens shared with Control UI | `--color-primary`, `--color-background` |
| `--nerve-*` | Nerve-specific | Variables unique to Nerve (not in Control UI) | `--nerve-active`, `--nerve-chrome` |
| `--shell-*` | Shell layout | Navigation, topbar, panel chrome sizing | `--shell-gap`, `--shell-nav-width` |
| `--panel-*` | Panel chrome | Panel padding, gaps, header heights | `--panel-pad`, `--panel-gap` |
| `--deck-*` | Deck (multi-column) | Multi-column chat layout variables | `--deck-gap`, `--deck-accent-1` |
| `--cm-*` | CodeMirror editor | Editor-specific colors and sizing | `--cm-bg`, `--cm-font-size` |
| `--font-*` | Font family | Display and sans font stacks | `--font-display`, `--font-sans` |
| `--nerve-font-*` | Font sizes | Step scale font sizes | `--nerve-font-xs` through `--nerve-font-lg` |
| `--nerve-lh-*` | Line heights | Tight / normal / relaxed | `--nerve-lh-tight` |
| `--shadow-*` | Shadows | Box-shadow presets | `--shadow-sm` through `--shadow-xl` |
| `--duration-*` | Animation duration | Transition timing | `--duration-fast`, `--duration-normal` |
| `--ease-*` | Easing curves | Transition easing functions | `--ease-in-out`, `--ease-spring` |

### Dual-Namespace (`--color-*` ↔ `--*`)

Nerve maintains a dual-namespace system for color variables. Both `--color-background` and `--background` refer to the same value. When a theme is applied:

- `--color-X` always sets the namespaced token
- If a key starts with `--color-`, the base form `--X` is **also** set automatically
- If a key is a base form (`--X`), the `--color-X` form is **also** set automatically

This ensures compatibility with both shadcn/ui components (which use `--background`) and Nerve's own `--color-*` convention.

### Cascade Order

Variables are applied in layers, later layers overriding earlier ones:

1. **foundation.css `:root`** — all defaults
2. **Built-in or imported theme** — overrides color variables via `applyTheme()` / `applyImportedTheme()`
3. **Layout template** — overrides spacing/sizing/density variables via `applyLayoutVariables()`
4. **High-contrast mode** — `[data-high-contrast="true"]` selector overrides chrome, shadows
5. **Theme overrides (editor)** — per-variable overrides via `setThemeOverride()`, applied directly to inline `style`
6. **Gateway bridge** — `seamColor` from gateway config overrides `--ring` / `--color-ring`

### Derived Variables

Many `--nerve-*` and `--cm-*` variables are *derived* — they reference other CSS variables rather than hard-coded colors:

```css
--nerve-active: var(--primary);         /* derived from --primary */
--nerve-panel-hover: color-mix(in srgb, var(--primary) 5%, var(--card));
--cm-highlight: color-mix(in srgb, var(--primary) 10%, transparent);
```

Derived variables automatically adapt when their base variables change. They're marked with `derived: true` in the variable spec registry and shown with a "derived" badge in the theme editor.

### Special Modes

**High Contrast** — when `data-high-contrast="true"` is set on `<html>`:
```css
[data-high-contrast="true"] {
  --nerve-chrome: var(--foreground);
  --nerve-panel: var(--background);
  --shadow-card: none;
  --shadow-lg: none;
  --shadow-xl: none;
}
```

**Reduced Motion** — `@media (prefers-reduced-motion: reduce)` collapses all durations to `0.001s`.

---

## 2. Theme Schema

**Source:** `src/lib/theme-schema.ts`

This module is the single source of truth for theme structure. All type definitions and validation logic live here.

### Core Types

```typescript
/** A complete Nerve theme: name + CSS custom property map. */
interface NerveTheme {
  name: string;                           // kebab-case ID (e.g. "midnight")
  label: string;                          // Human-readable (e.g. "Midnight")
  colors: Record<string, string>;         // CSS vars, keys include "--" prefix
  hljsTheme?: string;                     // highlight.js stylesheet name
  source?: 'built-in' | 'imported' | 'custom';
}

/** Layout template: overrides spacing/radii/sizing without touching colors. */
interface LayoutTemplate {
  name: string;                           // kebab-case ID
  label: string;                          // Human-readable
  description?: string;                   // Short description of the vibe
  overrides: Record<string, string>;     // CSS var overrides
}

/** A composed theme: color theme + optional layout template. */
interface ThemeComposition {
  theme: string;                          // ThemeName or imported theme ID
  layout?: string | null;                 // Layout template name (null = defaults)
}

/** Variable type for the theme editor. */
type VariableType = 'color' | 'length' | 'font' | 'duration' | 'easing' | 'shadow' | 'ratio';

/** Grouping for the theme editor UI (16 groups). */
type VariableGroup =
  | 'brand-colors' | 'surface-colors' | 'text-colors' | 'status-colors'
  | 'sidebar-colors' | 'chart-colors' | 'message-colors' | 'component-colors'
  | 'typography' | 'spacing' | 'borders-radii' | 'shadows'
  | 'animation' | 'layout' | 'deck-layout' | 'editor';

/** Metadata for a single CSS custom property (used by the visual editor). */
interface VariableSpec {
  property: string;        // CSS var name with "--" prefix
  label: string;           // Human-readable label
  group: VariableGroup;    // Editor section
  type: VariableType;      // Editor widget type
  default: string;         // Default value from :root
  description?: string;    // Help text
  derived?: boolean;       // true if computed (color-mix, var(), etc.)
}
```

### Validation

`validateTheme(colors)` checks that all required variables are present:

```typescript
const REQUIRED_THEME_VARIABLES = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground', '--accent', '--accent-foreground',
  '--destructive', '--destructive-foreground', '--border', '--input', '--ring',
];
```

Returns an array of missing variable names (empty = valid). Imported themes with missing variables will still work — missing keys fall back to `:root` defaults, and a console warning is logged.

### Normalization

`normalizeThemeColors(colors)` ensures the dual-namespace property works:

- For any `--color-X` key, adds `--X` if not already present
- For any `--X` key (excluding `--nerve-*`, `--deck-*`, `--cm-*`, `--shell-*`, `--font-*`, `--radius*`, `--shadow*`, `--duration*`, `--ease*`), adds `--color-X` if not already present

Always run imported theme colors through `normalizeThemeColors()` before applying.

### tweakcn Compatibility

The schema includes a `TWEAKCN_TO_NERVE_MAP` that maps tweakcn color token names to Nerve CSS variables. The `mapTweakcnColors()` function converts a tweakcn theme's colors into Nerve-compatible overrides, including semantic fallbacks for Nerve-specific variables that lack tweakcn equivalents.

`parseTweakcnInput(input)` classifies user input as one of:
- `url` — a full tweakcn URL
- `id` — a theme identifier
- `json` — a raw JSON object

---

## 3. Built-in Themes

**Source:** `src/lib/themes.ts`

### Theme List

| Name | Label | Primary Color | Background | Vibe |
|---|---|---|---|---|
| `midnight` | Midnight | `#39BAE6` (blue) | `#0a0e14` | Default dark — deep navy |
| `light` | Light | `#D97706` (amber) | `#FAFAFA` | Light mode — warm amber accents |
| `phosphor` | Phosphor | `#00FF41` (green) | `#080808` | CRT terminal aesthetic |
| `dracula` | Dracula | `#BD93F9` (purple) | `#282A36` | Classic Dracula palette |
| `nord` | Nord | `#88C0D0` (frost) | `#2E3440` | Arctic Nord colors |
| `solarized-dark` | Solarized Dark | `#268BD2` (blue) | `#002B36` | Solarized dark palette |
| `catppuccin-mocha` | Catppuccin Mocha | `#CBA6F7` (mauve) | `#1E1E2E` | Pastel dark theme |
| `tokyo-night` | Tokyo Night | `#7AA2F7` (blue) | `#1A1B26` | Tokyo Night palette |
| `gruvbox-dark` | Gruvbox Dark | `#FABD2F` (yellow) | `#282828` | Warm retro grooves |
| `one-dark` | One Dark | `#61AFEF` (blue) | `#282C34` | Atom One Dark |
| `monokai` | Monokai | `#F92672` (pink) | `#272822` | Classic Monokai |
| `ayu-dark` | Ayu Dark | `#F0B35D` (gold) | `#0C1016` | Ayu Dark flavor |
| `rose-pine` | Rosé Pine | `#EBBCBA` (rose) | `#191724` | Rosé Pine dark |
| `monochrome` | Monochrome | `#E0E0E0` (white) | `#0A0A0A` | Minimal grayscale |

### Theme Structure

Each built-in theme exports **70+ CSS variable definitions** covering:

- **Core semantic colors** (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring) — both `--color-*` and base forms
- **Semantic accent colors** (green, red, orange, purple, info)
- **Message backgrounds** (user, assistant, system)
- **Scrollbar colors** (track, hover)
- **Sidebar colors** (8 sidebar-specific tokens)
- **Chart colors** (5 chart palette slots)

The `ThemeName` type is a union of all 14 built-in names. `ExtendedThemeName` adds `'imported'` for custom/imported themes.

### Applying Themes

```typescript
// Apply a built-in theme (also sets highlight.js stylesheet)
applyTheme('dracula');

// Apply with layout overrides on top
applyTheme('tokyo-night', { '--shell-gap': '18px' });

// Apply an imported/custom theme
applyImportedTheme(myTheme.colors);

// Apply just layout variables from a template
applyLayoutVariables(layoutTemplates.compact.overrides);

// Clear previously applied layout variables
clearLayoutVariables(['--shell-gap', '--panel-pad']);
```

### highlight.js Integration

Each built-in theme maps to a highlight.js stylesheet (vendored locally at `/hljs/`). When `applyTheme()` runs, it swaps the `<link id="hljs-theme">` element to the matching stylesheet. Imported themes default to `github-dark-dimmed`.

---

## 4. Layout Templates

**Source:** `src/lib/layout-templates.ts`

Layout templates are **independent of color themes** — they only override spacing, sizing, radii, and density variables. You can combine any color theme with any layout template.

### Available Templates

| Name | Label | Description |
|---|---|---|
| `default` | Default | Uses foundation.css defaults — empty overrides |
| `compact` | Compact | Tight spacing, smaller radii, dense information layout |
| `comfortable` | Comfortable | Generous spacing, larger radii, relaxed feel |
| `monospace` | Monospace | Mono font everywhere, terminal aesthetic |
| `editor` | Editor | Optimized for code — wider chat area, larger code blocks |
| `high-contrast` | High Contrast | WCAG AAA compliant, maximum readability |
| `glassmorphism` | Glassmorphism | Translucent panels, blur effects, soft shadows |

### Template Override Details

**Compact:**

| Variable | Default | Compact |
|---|---|---|
| `--radius` | 0.667rem | 0.667rem |
| `--shell-gap` | 14px | 10px |
| `--shell-pad` | 14px | 10px |
| `--panel-pad` | 14px | 10px |
| `--panel-gap` | 8px | 4px |
| `--panel-header-height` | 48px | 40px |
| `--nerve-font-base` | 0.933rem | 0.867rem |
| `--shell-nav-width` | 260px | 220px |
| `--shell-topbar-height` | 48px | 40px |
| `--deck-header-height` | 36px | 32px |

**Comfortable:**

| Variable | Default | Comfortable |
|---|---|---|
| `--shell-gap` | 14px | 18px |
| `--shell-pad` | 14px | 18px |
| `--panel-pad` | 14px | 18px |
| `--panel-gap` | 8px | 12px |
| `--panel-header-height` | 48px | 56px |
| `--nerve-font-base` | 0.933rem | 1rem |
| `--shell-nav-width` | 260px | 280px |
| `--nerve-lh-relaxed` | 1.7 | 1.85 |

**Monospace:**

| Variable | Default | Monospace |
|---|---|---|
| `--font-sans` | Instrument Sans… | JetBrains Mono, Fira Code, Consolas… |
| `--font-display` | Instrument Sans… | JetBrains Mono, Fira Code, Consolas… |
| `--radius` | 0.667rem | 0.333rem |
| `--shell-gap` | 14px | 8px |
| `--nerve-heading-spacing` | -0.02em | 0 |

**Editor:**

| Variable | Default | Editor |
|---|---|---|
| `--nerve-chat-max-width` | none | `min(1280px, 88%)` |
| `--nerve-font-base` | 0.933rem | 0.933rem |
| `--nerve-lh-relaxed` | 1.7 | 1.75 |
| `--shell-nav-width` | 260px | 240px |

**High Contrast:**

| Variable | Default | High Contrast |
|---|---|---|
| `--nerve-font-base` | 0.933rem | 1rem |
| `--nerve-font-sm` | 0.733rem | 0.8rem |
| `--nerve-lh-normal` | 1.55 | 1.65 |
| `--nerve-heading-weight` | 600 | 700 |

**Glassmorphism:**

| Variable | Default | Glassmorphism |
|---|---|---|
| `--radius` | — | 1.333rem |
| `--shadow-card` | `0 18px 40px …` | `0 8px 32px …` |
| `--shadow-lg` | `0 12px 28px …` | `0 8px 32px …` |
| `--shell-gap` | 14px | 16px |
| `--deck-gutter-width` | 6px | 10px |

### Composition API

```typescript
/** Merge a layout template's overrides on top of a theme's colors. */
composeWithLayout(themeColors, 'compact');

/** Apply a layout template to the DOM directly (tracks what was set for cleanup). */
applyLayoutTemplate('compact');

/** Remove previously applied layout template variables. */
// applyLayoutTemplate handles cleanup internally via data-applied-layout-vars
```

When `applyLayoutTemplate()` is called, it:
1. Reads `root.dataset.appliedLayoutVars` to find previously set variables
2. Removes each previously set variable via `removeProperty()`
3. Applies the new template's overrides
4. Stores the newly applied variable names in `data-applied-layout-vars`

---

## 5. Variable Specs

**Source:** `src/lib/variable-specs.ts`

The variable spec registry defines metadata for every editable CSS custom property. The visual theme editor reads this to build its UI.

### Groups (16 sections)

| Group Key | Label | Icon | Description |
|---|---|---|---|
| `brand-colors` | Brand | 🎨 | Primary brand color, primary text, focus ring |
| `surface-colors` | Surfaces | 🔲 | Background, card, popover, secondary, muted, accent, destructive, border, input, scrollbar |
| `text-colors` | Text & Content | ✏️ | Green, red, orange, purple, info semantic colors |
| `status-colors` | Status & State | 🚦 | Active, idle, busy, complete, error, online, offline indicators |
| `sidebar-colors` | Sidebar | 📇 | Sidebar background, text, primary, accent, border, ring |
| `chart-colors` | Charts | 📊 | Chart palette slots 1–5 |
| `message-colors` | Messages | 💬 | User, assistant, system message backgrounds |
| `component-colors` | Components | 🧩 | Chrome, panel, link, assistant, audio, automations, channels, security, model, file |
| `typography` | Typography | 🔤 | Display font, heading weight/spacing, font size scale, line heights |
| `spacing` | Spacing | ↔️ | Shell gap/pad, panel pad/gap, content gap, row gap/pad, field gap |
| `borders-radii` | Borders & Radii | 📐 | Focus ring width, focus spread |
| `shadows` | Shadows | 🌫️ | Shadow SM/MD/LG/XL, card shadow, glow |
| `animation` | Animation | ⚡ | Duration fast/normal/slow, easing curves |
| `layout` | Layout | 📏 | Nav width, rail width, topbar height, panel header height, bar/chat max width |
| `deck-layout` | Deck Columns | 🃏 | Deck gap, column min width, header height, gutter width, accent stripe, accent colors 1–7 |
| `editor` | Code Editor | 💻 | Editor bg, border, font size, line height, text, muted, links, success/danger/warning/info, highlight, callout |

### Spec Types

| Type | Editor Widget | Description |
|---|---|---|
| `color` | Color picker + swatch | Hex/rgb/hsl colors — shows native `<input type="color">` + hex display |
| `length` | Text input | CSS lengths (`14px`, `1rem`, `0.933rem`) |
| `font` | Text input | Font family stacks |
| `shadow` | Text input | Box-shadow values |
| `easing` | Text input | Cubic-bezier curves |
| `duration` | Text input | Time values (`0.15s`) |
| `ratio` | Text input | Numeric ratios (line heights like `1.55`) |

### Spec Count

The registry contains **100+ specs** across 16 groups. Many component/status variables are marked `derived: true`, indicating they reference other CSS variables (e.g., `var(--primary)`) and will auto-adapt when their base changes.

### Utility Functions

```typescript
/** Get all specs organized by group. */
getSpecsByGroup(): Record<VariableGroup, VariableSpec[]>

/** Look up a spec by CSS property name. */
getSpecByProperty('--color-primary'): VariableSpec | undefined

/** Check if a value is a plain hex/rgb/hsl color (not derived). */
isPlainColor('#39BAE6')  // true
isPlainColor('var(--primary)')  // false
```

---

## 6. Visual Theme Editor

**Source:** `src/features/settings/ThemeEditorPanel.tsx`

The theme editor is a live CSS variable editor embedded in the Appearance settings panel. Every change applies immediately to the document root.

### Features

- **Collapsible group sections** — 16 sections matching `VARIABLE_SPECS` groups, each with an icon and override count badge
- **Color pickers** — native `<input type="color">` with a clickable swatch for `color`-type variables
- **Text inputs** — for `length`, `font`, `shadow`, `easing`, `duration`, and `ratio` types
- **Derived variable indicators** — "derived" badge shown next to variables that reference other CSS vars
- **Search** — filters across label, property name, and description
- **Reset per-variable** — small reset button (↻) on each overridden variable
- **Reset all** — clears every override at once
- **Export as CSS** — copies all overrides as a `:root { ... }` block to clipboard
- **Export as JSON** — copies all overrides as a JSON object to clipboard
- **localStorage persistence** — overrides survive page reloads (`nerve:theme:overrides` key)
- **Expanded group state** — which sections are open/closed persists (`nerve:theme:editor-expanded-groups` key)
- **Override count badge** — shows how many variables are overridden in the header and per-group

### Component API

```typescript
interface ThemeEditorPanelProps {
  overrides: ThemeOverrides;              // Current overrides map
  setOverride: (property: string, value: string | null) => void;  // Set/clear one override
  resetAll: () => void;                  // Clear all overrides
  resetOne: (property: string) => void;  // Clear one override
}

interface ThemeOverrides {
  [property: string]: string;  // CSS property → custom value
}
```

### Storage Keys

| Key | Purpose |
|---|---|
| `nerve:theme:overrides` | Current override map (JSON) |
| `nerve:theme:editor-expanded-groups` | Which sections are expanded (JSON array) |

---

## 7. Settings Integration

### SettingsContext

**Source:** `src/contexts/SettingsContext.tsx`

The `SettingsContext` provides the full theme management API to the component tree:

```typescript
interface SettingsContextValue {
  // ... other settings ...
  
  // Theme selection
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  
  // Layout template
  layoutTemplate: string;
  setLayoutTemplate: (name: string) => void;
  
  // Imported theme
  importedTheme: NerveTheme | null;
  setImportedTheme: (theme: NerveTheme | null) => void;
  
  // High contrast
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
  
  // Per-variable overrides (theme editor)
  themeOverrides: Record<string, string>;
  setThemeOverride: (property: string, value: string | null) => void;
  resetThemeOverride: (property: string) => void;
  resetAllThemeOverrides: () => void;
}
```

### Application Order (Effects)

On mount and when dependencies change, the context applies layers in order:

1. **Theme colors** — `applyTheme(theme)` or `applyImportedTheme(importedTheme.colors)` if an imported theme is active
2. **Layout template** — `applyLayoutVariables()` for non-default templates, or `clearLayoutVariables()` for default
3. **High contrast** — sets/removes `data-high-contrast="true"` attribute on `<html>`
4. **Theme overrides** — iterates `themeOverrides` and calls `root.style.setProperty()` for each
5. **Gateway bridge** — fetches gateway public config and applies `seamColor` as `--ring` / `--color-ring` (skipped if imported theme is active — imported themes take priority)

### Override Functions

| Function | Behavior |
|---|---|
| `setThemeOverride(property, value)` | Sets an override and applies it to DOM. Pass `null` or `''` to clear. |
| `resetThemeOverride(property)` | Removes one override and the DOM property, falling back to theme default. |
| `resetAllThemeOverrides()` | Removes all overrides from DOM and clears the overrides map. |

All overrides persist to `localStorage` via `saveThemeOverrides()`.

### AppearanceSettings

**Source:** `src/features/settings/AppearanceSettings.tsx`

The Appearance settings panel provides the user-facing controls:

- **Theme selector** — dropdown with all 14 built-in themes
- **Layout template selector** — dropdown with all 7 layout templates
- **High contrast toggle** — Switch component
- **Chat layout mode** — single vs. deck mode
- **Font / font size / editor font size** — selectors
- **Import theme** — text input for tweakcn URLs or JSON, with import button
- **Export theme** — Copy CSS / Copy JSON buttons (for imported themes)
- **Theme Editor** — collapsible section that opens the `ThemeEditorPanel`

---

## 8. Import / Export

**Source:** `src/lib/theme-io.ts`

### Import Formats

| Format | Input | Parser | Notes |
|---|---|---|---|
| tweakcn URL | `https://tweakcn.com/r/themes/amethyst-haze` | `fetchTweakcnTheme()` | Fetches from registry API, maps via `TWEAKCN_TO_NERVE_MAP` |
| tweakcn ID | `amethyst-haze` | `fetchTweakcnTheme()` | Same API call, treated as theme ID |
| tweakcn editor URL | `https://tweakcn.com/editor/theme?theme=amethyst-haze` | `fetchTweakcnTheme()` | Extracts ID from query param |
| Raw JSON | `{ "colors": { ... } }` | `fetchTweakcnTheme()` | Parsed inline, no network call |
| CSS snippet | `:root { --color-primary: #ff0; }` | `importFromCSS()` | Regex extraction of `--var: value` pairs |

All imports go through `normalizeThemeColors()` to fill in the dual-namespace.

### Export Formats

| Format | Function | Output |
|---|---|---|
| CSS | `exportAsCSS(theme)` | `:root { --color-background: #0a0e14; ... }` |
| JSON | `exportAsJSON(theme)` | `{ "name": "...", "label": "...", "colors": { ... } }` |
| tweakcn | `exportAsTweakcn(theme)` | `{ "name": "...", "type": "dark", "colors": { "background": "#0a0e14", ... } }` |

The CSS export sorts variables alphabetically. The tweakcn export reverse-maps `--color-X` back to `X` and excludes Nerve-specific namespaces (`--nerve-*`, `--deck-*`, `--cm-*`, `--shell-*`).

### Browser-Local Persistence

Imported themes and layout template selection are stored in `localStorage`:

| Key | Purpose |
|---|---|
| `nerve:theme:imported` | Imported theme JSON (single slot — one imported theme at a time) |
| `nerve:theme:layout` | Selected layout template name |

```typescript
saveImportedTheme(theme);    // Persist imported theme
loadImportedTheme();         // → NerveTheme | null
clearImportedTheme();        // Remove imported theme

saveLayoutTemplate('compact');   // Persist layout choice
loadLayoutTemplate();           // → string | null
```

### Gateway Theme Bridge

**Source:** `src/lib/gateway-theme.ts`

The gateway bridge reads server-side config (`ui.seamColor`) and applies it as a CSS override:

```typescript
interface GatewayThemeConfig {
  seamColor?: string;        // → --color-ring and --ring
  assistantName?: string;    // (read but not applied as CSS)
  assistantAvatar?: string;  // (read but not applied as CSS)
}
```

The bridge fetches from `/api/config/public` (no auth required). Local Nerve theme settings always take priority — the gateway seam color is only applied when no imported theme is active.

---

## 9. Quick Start

### Create a Custom Theme via the Visual Editor

1. Open **Settings → Appearance**
2. Expand the **Theme Editor** section
3. Pick a built-in theme as your starting point
4. Edit variables in any group — changes apply live
5. Use the search bar to find specific variables
6. Click the **CSS** or **JSON** button to copy your overrides to clipboard
7. Save them to a file for later import

### Import a Theme

**From tweakcn:**

1. Find a theme on [tweakcn.com](https://tweakcn.com)
2. Copy its URL or theme ID
3. Open **Settings → Appearance → Import theme**
4. Paste the URL or ID and click **Import**
5. The theme replaces your color palette immediately

**From CSS:**

```javascript
// In browser console or a script:
const css = `:root {
  --color-primary: #F0B35D;
  --color-background: #0C1016;
  --color-foreground: #D0C8BC;
  /* ... more variables ... */
}`;

// Parse and normalize
const { importFromCSS, normalizeThemeColors } = await import('/src/lib/theme-io.ts');
const theme = importFromCSS(css, 'my-custom-theme');
```

**From JSON:**

```json
{
  "name": "my-theme",
  "label": "My Custom Theme",
  "colors": {
    "--color-primary": "#F0B35D",
    "--color-background": "#0C1016",
    "--color-foreground": "#D0C8BC"
  }
}
```

Paste the JSON into the import field and click **Import**.

### Apply a Layout Template

1. Open **Settings → Appearance**
2. Use the **Layout** dropdown to select a template
3. The spacing/density changes apply immediately on top of your current color theme
4. Templates are independent — switch color theme and layout template independently

### Programmatic Theme Application

```typescript
import { applyTheme, applyImportedTheme } from '@/lib/themes';
import { applyLayoutTemplate, composeWithLayout } from '@/lib/layout-templates';
import { themes } from '@/lib/themes';

// Apply a built-in theme
applyTheme('dracula');

// Apply a built-in theme + compact layout
const merged = composeWithLayout(themes.dracula.colors, 'compact');
applyTheme('dracula', layoutTemplates.compact.overrides);

// Apply an imported theme
applyImportedTheme(myCustomTheme.colors);

// Apply layout template independently
applyLayoutTemplate('monospace');
```

### Export Your Theme

1. With an imported theme active, click **Copy CSS** or **Copy JSON** in the Export section
2. In the Theme Editor, the **CSS** / **JSON** buttons export only your overrides (delta from the base theme)

### Required Variables for Custom Themes

At minimum, a custom theme must define these 17 variables:

```
--background      --foreground       --card            --card-foreground
--primary         --primary-foreground  --secondary     --secondary-foreground
--muted           --muted-foreground  --accent         --accent-foreground
--destructive     --destructive-foreground  --border    --input  --ring
```

Any missing variables fall back to `:root` defaults in `foundation.css`. The dual-namespace system means you can define either `--color-X` or `--X` forms — `normalizeThemeColors()` fills in the other.