/**
 * Variable Specs — Registry of all editable CSS custom properties.
 *
 * Each spec defines:
 * - property: the CSS variable name (--color-background, --shell-gap, etc.)
 * - label: human-readable name
 * - group: which editor section it appears in
 * - type: what kind of editor widget to use (color, length, font, etc.)
 * - default: the :root default from foundation.css / index.css
 * - description: optional help text
 * - derived: true if this is a computed value (color-mix, var(), etc.)
 *
 * The visual theme editor reads this to build its UI.
 * Groups map to collapsible sections in the editor panel.
 */

import type { VariableSpec, VariableGroup } from './theme-schema';

// ────────────────────────────────────────────────────────
// Group definitions (order = display order in editor)
// ────────────────────────────────────────────────────────

export const GROUP_META: Record<VariableGroup, { label: string; icon: string }> = {
  'brand-colors':        { label: 'Brand',           icon: '🎨' },
  'surface-colors':      { label: 'Surfaces',        icon: '🔲' },
  'text-colors':         { label: 'Text & Content',  icon: '✏️' },
  'status-colors':        { label: 'Status & State',  icon: '🚦' },
  'sidebar-colors':      { label: 'Sidebar',         icon: '📇' },
  'chart-colors':        { label: 'Charts',          icon: '📊' },
  'message-colors':      { label: 'Messages',        icon: '💬' },
  'component-colors':    { label: 'Components',       icon: '🧩' },
  'typography':           { label: 'Typography',      icon: '🔤' },
  'spacing':              { label: 'Spacing',          icon: '↔️' },
  'borders-radii':        { label: 'Borders & Radii', icon: '📐' },
  'shadows':              { label: 'Shadows',          icon: '🌫️' },
  'animation':            { label: 'Animation',         icon: '⚡' },
  'layout':               { label: 'Layout',            icon: '📏' },
  'deck-layout':          { label: 'Deck Columns',      icon: '🃏' },
  'editor':               { label: 'Code Editor',       icon: '💻' },
};

// ────────────────────────────────────────────────────────
// Variable specifications
// ────────────────────────────────────────────────────────

export const VARIABLE_SPECS: VariableSpec[] = [
  // ── Brand colors ────────────────────────────────────────
  { property: '--color-primary',              label: 'Primary',               group: 'brand-colors',     type: 'color', default: '#39BAE6', description: 'Main brand color — links, buttons, active states' },
  { property: '--color-primary-foreground',   label: 'Primary text',          group: 'brand-colors',     type: 'color', default: '#0a0e14', description: 'Text on primary backgrounds' },
  { property: '--color-ring',                 label: 'Focus ring',            group: 'brand-colors',     type: 'color', default: '#39BAE6', description: 'Keyboard focus ring color' },

  // ── Surface colors ─────────────────────────────────────
  { property: '--color-background',           label: 'Background',            group: 'surface-colors',   type: 'color', default: '#0a0e14', description: 'Main app background' },
  { property: '--color-foreground',           label: 'Foreground',            group: 'surface-colors',   type: 'color', default: '#B3B1AD', description: 'Default text color' },
  { property: '--color-card',                 label: 'Card',                  group: 'surface-colors',   type: 'color', default: '#0d1117', description: 'Card/panel background' },
  { property: '--color-card-foreground',      label: 'Card text',             group: 'surface-colors',   type: 'color', default: '#B3B1AD', description: 'Text on card backgrounds' },
  { property: '--color-popover',              label: 'Popover',               group: 'surface-colors',   type: 'color', default: '#0d1117', description: 'Dropdown/popover background' },
  { property: '--color-popover-foreground',   label: 'Popover text',          group: 'surface-colors',   type: 'color', default: '#B3B1AD', description: 'Text on popover backgrounds' },
  { property: '--color-secondary',            label: 'Secondary',             group: 'surface-colors',   type: 'color', default: '#151b23', description: 'Secondary surface (chrome, hover)' },
  { property: '--color-secondary-foreground', label: 'Secondary text',        group: 'surface-colors',   type: 'color', default: '#B3B1AD', description: 'Text on secondary surfaces' },
  { property: '--color-muted',                label: 'Muted',                 group: 'surface-colors',   type: 'color', default: '#151b23', description: 'Muted/de-emphasized background' },
  { property: '--color-muted-foreground',     label: 'Muted text',            group: 'surface-colors',   type: 'color', default: '#6c7380', description: 'De-emphasized text color' },
  { property: '--color-accent',               label: 'Accent',                group: 'surface-colors',   type: 'color', default: '#151b23', description: 'Accent highlight background' },
  { property: '--color-accent-foreground',    label: 'Accent text',           group: 'surface-colors',   type: 'color', default: '#B3B1AD', description: 'Text on accent backgrounds' },
  { property: '--color-destructive',          label: 'Destructive',           group: 'surface-colors',   type: 'color', default: '#FF3333', description: 'Error/danger background' },
  { property: '--color-destructive-foreground',label: 'Destructive text',      group: 'surface-colors',   type: 'color', default: '#B3B1AD', description: 'Text on destructive backgrounds' },
  { property: '--color-border',              label: 'Border',                group: 'surface-colors',   type: 'color', default: '#1e2530', description: 'Default border color' },
  { property: '--color-input',               label: 'Input border',          group: 'surface-colors',   type: 'color', default: '#1e2530', description: 'Input field border color' },
  { property: '--color-scrollbar',            label: 'Scrollbar',             group: 'surface-colors',   type: 'color', default: '#1e2530', description: 'Scrollbar track color' },
  { property: '--color-scrollbar-hover',      label: 'Scrollbar hover',      group: 'surface-colors',   type: 'color', default: '#2d3848', description: 'Scrollbar thumb on hover' },

  // ── Text & Content colors ───────────────────────────────
  { property: '--color-green',   label: 'Green (success)',   group: 'text-colors', type: 'color', default: '#7FD962', description: 'Success/positive indicator' },
  { property: '--color-red',     label: 'Red (error)',       group: 'text-colors', type: 'color', default: '#FF3333', description: 'Error/negative indicator' },
  { property: '--color-orange',  label: 'Orange (warning)',  group: 'text-colors', type: 'color', default: '#FF8F40', description: 'Warning/attention indicator' },
  { property: '--color-purple',  label: 'Purple (accent)',   group: 'text-colors', type: 'color', default: '#D2A6FF', description: 'Secondary accent color' },
  { property: '--color-info',    label: 'Info blue',         group: 'text-colors', type: 'color', default: '#39BAE6', description: 'Informational indicator' },

  // ── Status & State ──────────────────────────────────────
  { property: '--nerve-active',   label: 'Active',    group: 'status-colors', type: 'color', default: 'var(--primary)', derived: true, description: 'Active session indicator' },
  { property: '--nerve-idle',     label: 'Idle',      group: 'status-colors', type: 'color', default: 'var(--muted-foreground)', derived: true, description: 'Idle session indicator' },
  { property: '--nerve-busy',     label: 'Busy',      group: 'status-colors', type: 'color', default: 'var(--orange)', derived: true, description: 'Busy/working indicator' },
  { property: '--nerve-complete', label: 'Complete',  group: 'status-colors', type: 'color', default: 'var(--green)', derived: true, description: 'Task complete indicator' },
  { property: '--nerve-error',    label: 'Error',     group: 'status-colors', type: 'color', default: 'var(--destructive)', derived: true, description: 'Error state indicator' },
  { property: '--nerve-online',   label: 'Online',    group: 'status-colors', type: 'color', default: 'var(--green)', derived: true, description: 'Online/presence indicator' },
  { property: '--nerve-offline',  label: 'Offline',   group: 'status-colors', type: 'color', default: 'var(--muted-foreground)', derived: true, description: 'Offline/disconnected indicator' },

  // ── Sidebar ────────────────────────────────────────────
  { property: '--color-sidebar',                    label: 'Sidebar background',        group: 'sidebar-colors', type: 'color', default: '#0d1117' },
  { property: '--color-sidebar-foreground',          label: 'Sidebar text',              group: 'sidebar-colors', type: 'color', default: '#B3B1AD' },
  { property: '--color-sidebar-primary',             label: 'Sidebar primary',           group: 'sidebar-colors', type: 'color', default: '#39BAE6' },
  { property: '--color-sidebar-primary-foreground',  label: 'Sidebar primary text',      group: 'sidebar-colors', type: 'color', default: '#0a0e14' },
  { property: '--color-sidebar-accent',              label: 'Sidebar accent',            group: 'sidebar-colors', type: 'color', default: '#151b23' },
  { property: '--color-sidebar-accent-foreground',   label: 'Sidebar accent text',       group: 'sidebar-colors', type: 'color', default: '#B3B1AD' },
  { property: '--color-sidebar-border',              label: 'Sidebar border',            group: 'sidebar-colors', type: 'color', default: '#1e2530' },
  { property: '--color-sidebar-ring',                label: 'Sidebar focus ring',        group: 'sidebar-colors', type: 'color', default: '#39BAE6' },

  // ── Chart colors ───────────────────────────────────────
  { property: '--color-chart-1', label: 'Chart 1', group: 'chart-colors', type: 'color', default: '#39BAE6' },
  { property: '--color-chart-2', label: 'Chart 2', group: 'chart-colors', type: 'color', default: '#7FD962' },
  { property: '--color-chart-3', label: 'Chart 3', group: 'chart-colors', type: 'color', default: '#D2A6FF' },
  { property: '--color-chart-4', label: 'Chart 4', group: 'chart-colors', type: 'color', default: '#FF3333' },
  { property: '--color-chart-5', label: 'Chart 5', group: 'chart-colors', type: 'color', default: '#FF8F40' },

  // ── Message colors ─────────────────────────────────────
  { property: '--color-message-user',      label: 'User message bg',     group: 'message-colors', type: 'color', default: '#0d1020', description: 'Background for user messages' },
  { property: '--color-message-assistant', label: 'Assistant message bg', group: 'message-colors', type: 'color', default: '#0d1410', description: 'Background for assistant messages' },
  { property: '--color-message-system',    label: 'System message bg',   group: 'message-colors', type: 'color', default: '#0d0e1a', description: 'Background for system messages' },

  // ── Component colors ────────────────────────────────────
  { property: '--nerve-chrome',          label: 'Chrome',           group: 'component-colors', type: 'color', default: 'var(--secondary)', derived: true, description: 'Top bar / navigation chrome' },
  { property: '--nerve-chrome-strong',   label: 'Chrome strong',    group: 'component-colors', type: 'color', default: 'var(--border)', derived: true, description: 'Strong chrome borders' },
  { property: '--nerve-panel',          label: 'Panel',            group: 'component-colors', type: 'color', default: 'var(--card)', derived: true, description: 'Panel backgrounds' },
  { property: '--nerve-panel-hover',     label: 'Panel hover',      group: 'component-colors', type: 'color', default: 'color-mix(in srgb, var(--primary) 5%, var(--card))', derived: true, description: 'Panel hover state' },
  { property: '--nerve-link',           label: 'Link',             group: 'component-colors', type: 'color', default: 'var(--primary)', derived: true, description: 'Link color' },
  { property: '--nerve-assistant',       label: 'Assistant',        group: 'component-colors', type: 'color', default: 'var(--primary)', derived: true, description: 'Assistant identity color' },
  { property: '--nerve-audio',          label: 'Audio/Talk',        group: 'component-colors', type: 'color', default: 'var(--green)', derived: true, description: 'Voice/audio indicator' },
  { property: '--nerve-automations',     label: 'Automations',      group: 'component-colors', type: 'color', default: 'var(--purple)', derived: true, description: 'Cron/automation indicator' },
  { property: '--nerve-channels',        label: 'Channels',         group: 'component-colors', type: 'color', default: 'var(--info)', derived: true, description: 'Channel indicator' },
  { property: '--nerve-security',        label: 'Security',         group: 'component-colors', type: 'color', default: 'var(--destructive)', derived: true, description: 'Security indicator' },
  { property: '--nerve-model',           label: 'Model',            group: 'component-colors', type: 'color', default: 'var(--info)', derived: true, description: 'Model indicator' },
  { property: '--nerve-file',            label: 'File browser',     group: 'component-colors', type: 'color', default: 'var(--info)', derived: true, description: 'File browser indicator' },

  // ── Typography ──────────────────────────────────────────
  { property: '--font-display',          label: 'Display font',      group: 'typography', type: 'font', default: "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif" },
  { property: '--nerve-heading-weight',  label: 'Heading weight',   group: 'typography', type: 'length', default: '600', description: 'Font weight for headings (100-900)' },
  { property: '--nerve-heading-spacing', label: 'Heading spacing',  group: 'typography', type: 'length', default: '-0.02em', description: 'Letter spacing for headings' },
  { property: '--nerve-font-xs',         label: 'Font XS',           group: 'typography', type: 'length', default: '0.667rem', description: 'Extra-small text (badges, kbd)' },
  { property: '--nerve-font-sm',         label: 'Font SM',           group: 'typography', type: 'length', default: '0.733rem', description: 'Small text (labels)' },
  { property: '--nerve-font-md',         label: 'Font MD',           group: 'typography', type: 'length', default: '0.8rem', description: 'Medium text (hints)' },
  { property: '--nerve-font-base',       label: 'Font base',         group: 'typography', type: 'length', default: '0.933rem', description: 'Base body text size' },
  { property: '--nerve-font-lg',         label: 'Font LG',           group: 'typography', type: 'length', default: '1.05rem', description: 'Large text (titles)' },
  { property: '--nerve-lh-tight',        label: 'Line height tight',  group: 'typography', type: 'ratio', default: '1.2', description: 'Tight line height for headings' },
  { property: '--nerve-lh-normal',       label: 'Line height normal', group: 'typography', type: 'ratio', default: '1.55', description: 'Normal line height for body' },
  { property: '--nerve-lh-relaxed',      label: 'Line height relaxed', group: 'typography', type: 'ratio', default: '1.7', description: 'Relaxed line height for prose' },

  // ── Spacing ─────────────────────────────────────────────
  { property: '--shell-gap',           label: 'Shell gap',            group: 'spacing', type: 'length', default: '14px', description: 'Main shell gap' },
  { property: '--shell-pad',           label: 'Shell padding',        group: 'spacing', type: 'length', default: '14px', description: 'Main shell padding' },
  { property: '--panel-pad',           label: 'Panel padding',       group: 'spacing', type: 'length', default: '14px', description: 'Panel internal padding' },
  { property: '--panel-gap',           label: 'Panel gap',            group: 'spacing', type: 'length', default: '8px', description: 'Panel internal gap' },
  { property: '--nerve-content-gap',   label: 'Content gap',         group: 'spacing', type: 'length', default: '0.8em', description: 'Paragraph spacing in messages' },
  { property: '--nerve-row-gap',       label: 'Row gap',             group: 'spacing', type: 'length', default: '14px', description: 'Cockpit row gap' },
  { property: '--nerve-row-pad',       label: 'Row padding',         group: 'spacing', type: 'length', default: '14px 16px', description: 'Cockpit row padding' },
  { property: '--nerve-field-gap',      label: 'Field gap',          group: 'spacing', type: 'length', default: '8px', description: 'Cockpit field gap' },

  // ── Borders & Radii ────────────────────────────────────
  { property: '--focus-ring',     label: 'Focus ring width',  group: 'borders-radii', type: 'length', default: '3px', description: 'Keyboard focus ring thickness' },
  { property: '--focus-spread',   label: 'Focus spread',      group: 'borders-radii', type: 'length', default: '4px', description: 'Focus ring spread' },

  // ── Shadows ─────────────────────────────────────────────
  { property: '--shadow-sm',    label: 'Shadow SM',    group: 'shadows', type: 'shadow', default: '0 1px 2px rgba(0, 0, 0, 0.06)' },
  { property: '--shadow-md',    label: 'Shadow MD',    group: 'shadows', type: 'shadow', default: '0 4px 12px rgba(0, 0, 0, 0.12)' },
  { property: '--shadow-lg',    label: 'Shadow LG',    group: 'shadows', type: 'shadow', default: '0 12px 28px rgba(0, 0, 0, 0.2)' },
  { property: '--shadow-xl',    label: 'Shadow XL',    group: 'shadows', type: 'shadow', default: '0 34px 90px rgba(0, 0, 0, 0.42)' },
  { property: '--shadow-card',  label: 'Shadow card',  group: 'shadows', type: 'shadow', default: '0 18px 40px rgba(0, 0, 0, 0.18)' },
  { property: '--shadow-glow',  label: 'Shadow glow',  group: 'shadows', type: 'shadow', default: '0 0 18px rgba(0, 0, 0, 0.12)' },

  // ── Animation ──────────────────────────────────────────
  { property: '--duration-fast',    label: 'Duration fast',    group: 'animation', type: 'duration', default: '0.1s', description: 'Quick transitions' },
  { property: '--duration-normal',  label: 'Duration normal',  group: 'animation', type: 'duration', default: '0.15s', description: 'Standard transitions' },
  { property: '--duration-slow',    label: 'Duration slow',    group: 'animation', type: 'duration', default: '0.25s', description: 'Slow transitions' },
  { property: '--ease-in-out',      label: 'Ease in-out',      group: 'animation', type: 'easing', default: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { property: '--ease-out',         label: 'Ease out',          group: 'animation', type: 'easing', default: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  { property: '--ease-spring',      label: 'Ease spring',      group: 'animation', type: 'easing', default: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },

  // ── Layout ─────────────────────────────────────────────
  { property: '--shell-nav-width',      label: 'Nav width',          group: 'layout', type: 'length', default: '260px', description: 'Sidebar navigation width' },
  { property: '--shell-nav-rail-width', label: 'Nav rail width',     group: 'layout', type: 'length', default: '52px', description: 'Collapsed nav rail width' },
  { property: '--shell-topbar-height',  label: 'Top bar height',     group: 'layout', type: 'length', default: '48px', description: 'Top chrome bar height' },
  { property: '--panel-header-height',  label: 'Panel header height', group: 'layout', type: 'length', default: '48px', description: 'Panel header row height' },
  { property: '--bar-max-width',        label: 'Bar max width',       group: 'layout', type: 'length', default: 'none', description: 'Max width for bar elements' },
  { property: '--nerve-chat-max-width', label: 'Chat max width',     group: 'layout', type: 'length', default: 'none', description: 'Max width for chat messages' },

  // ── Deck layout ────────────────────────────────────────
  { property: '--deck-gap',               label: 'Deck gap',             group: 'deck-layout', type: 'length', default: '2px' },
  { property: '--deck-column-min-width',  label: 'Column min width',     group: 'deck-layout', type: 'length', default: '320px' },
  { property: '--deck-header-height',     label: 'Column header height', group: 'deck-layout', type: 'length', default: '36px' },
  { property: '--deck-gutter-width',      label: 'Resize gutter width',  group: 'deck-layout', type: 'length', default: '6px' },
  { property: '--deck-accent-width',      label: 'Accent stripe width',  group: 'deck-layout', type: 'length', default: '3px' },
  { property: '--deck-accent-1', label: 'Column accent 1 (blue)',   group: 'deck-layout', type: 'color', default: '#39BAE6' },
  { property: '--deck-accent-2', label: 'Column accent 2 (green)',  group: 'deck-layout', type: 'color', default: '#7FD962' },
  { property: '--deck-accent-3', label: 'Column accent 3 (purple)', group: 'deck-layout', type: 'color', default: '#D2A6FF' },
  { property: '--deck-accent-4', label: 'Column accent 4 (orange)', group: 'deck-layout', type: 'color', default: '#FF8F40' },
  { property: '--deck-accent-5', label: 'Column accent 5 (red)',    group: 'deck-layout', type: 'color', default: '#FF6E6E' },
  { property: '--deck-accent-6', label: 'Column accent 6 (teal)',   group: 'deck-layout', type: 'color', default: '#6DD6D6' },
  { property: '--deck-accent-7', label: 'Column accent 7 (yellow)', group: 'deck-layout', type: 'color', default: '#E8C45A' },

  // ── Code Editor ────────────────────────────────────────
  { property: '--cm-bg',               label: 'Editor background',  group: 'editor', type: 'color', default: 'var(--background)', derived: true },
  { property: '--cm-border',           label: 'Editor border',     group: 'editor', type: 'color', default: 'var(--border)', derived: true },
  { property: '--cm-font-size',        label: 'Editor font size',  group: 'editor', type: 'length', default: '0.867rem' },
  { property: '--cm-line-height',      label: 'Editor line height', group: 'editor', type: 'ratio', default: '1.55' },
  { property: '--cm-text',             label: 'Editor text',       group: 'editor', type: 'color', default: 'var(--foreground)', derived: true },
  { property: '--cm-muted',            label: 'Editor muted',      group: 'editor', type: 'color', default: 'var(--muted-foreground)', derived: true },
  { property: '--cm-link',             label: 'Editor links',      group: 'editor', type: 'color', default: 'var(--primary)', derived: true },
  { property: '--cm-success',          label: 'Editor success',     group: 'editor', type: 'color', default: 'var(--green)', derived: true },
  { property: '--cm-danger',           label: 'Editor danger',     group: 'editor', type: 'color', default: 'var(--destructive)', derived: true },
  { property: '--cm-warning',          label: 'Editor warning',    group: 'editor', type: 'color', default: 'var(--orange)', derived: true },
  { property: '--cm-info',             label: 'Editor info',       group: 'editor', type: 'color', default: 'var(--info)', derived: true },
  { property: '--cm-highlight',       label: 'Editor highlight',  group: 'editor', type: 'color', default: 'color-mix(in srgb, var(--primary) 10%, transparent)', derived: true },
  { property: '--cm-callout-bg',       label: 'Callout background', group: 'editor', type: 'color', default: 'color-mix(in srgb, var(--primary) 5%, var(--card))', derived: true },
];

/** Get specs grouped by VariableGroup for the editor UI. */
export function getSpecsByGroup(): Record<VariableGroup, VariableSpec[]> {
  const result = {} as Record<VariableGroup, VariableSpec[]>;
  for (const spec of VARIABLE_SPECS) {
    if (!result[spec.group]) result[spec.group] = [];
    result[spec.group].push(spec);
  }
  return result;
}

/** Look up a spec by CSS property name. */
export function getSpecByProperty(property: string): VariableSpec | undefined {
  return VARIABLE_SPECS.find(s => s.property === property);
}

/** Check if a value looks like a plain hex/rgb/hsl color (not derived). */
export function isPlainColor(value: string): boolean {
  return /^#([0-9a-f]{3,8})$/i.test(value) || /^rgb\(/.test(value) || /^hsl\(/.test(value);
}