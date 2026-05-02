/**
 * Nerve Layout Templates
 * 
 * Layout templates override spacing, sizing, radii, and density
 * WITHOUT touching colors. They compose with color themes independently.
 * 
 * Each template only defines the variables it overrides — 
 * anything not listed falls back to the :root defaults in foundation.css.
 */

import type { LayoutTemplate } from './theme-schema';

export const layoutTemplates: Record<string, LayoutTemplate> = {
  'default': {
    name: 'default',
    label: 'Default',
    overrides: {}, // Uses foundation.css defaults as-is
  },

  'compact': {
    name: 'compact',
    label: 'Compact',
    description: 'Tight spacing, smaller radii, dense information layout',
    overrides: {
      '--radius': '0.667rem',
      '--shell-gap': '10px',
      '--shell-pad': '10px',
      '--panel-pad': '10px',
      '--panel-gap': '4px',
      '--panel-header-height': '40px',
      '--nerve-content-gap': '0.6em',
      '--nerve-row-gap': '10px',
      '--nerve-row-pad': '10px 12px',
      '--nerve-field-gap': '6px',
      '--nerve-font-xs': '0.6rem',
      '--nerve-font-sm': '0.667rem',
      '--nerve-font-md': '0.733rem',
      '--nerve-font-base': '0.867rem',
      '--nerve-font-lg': '0.933rem',
      '--nerve-lh-normal': '1.45',
      '--nerve-lh-relaxed': '1.6',
      '--shell-nav-width': '220px',
      '--shell-nav-rail-width': '44px',
      '--shell-topbar-height': '40px',
      '--deck-header-height': '32px',
      '--deck-gutter-width': '3px',
    },
  },

  'comfortable': {
    name: 'comfortable',
    label: 'Comfortable',
    description: 'Generous spacing, larger radii, relaxed feel',
    overrides: {
      '--radius': '1.467rem',
      '--shell-gap': '18px',
      '--shell-pad': '18px',
      '--panel-pad': '18px',
      '--panel-gap': '12px',
      '--panel-header-height': '56px',
      '--nerve-content-gap': '1em',
      '--nerve-row-gap': '18px',
      '--nerve-row-pad': '18px 22px',
      '--nerve-field-gap': '10px',
      '--nerve-font-xs': '0.733rem',
      '--nerve-font-sm': '0.8rem',
      '--nerve-font-md': '0.867rem',
      '--nerve-font-base': '1rem',
      '--nerve-font-lg': '1.133rem',
      '--nerve-lh-normal': '1.65',
      '--nerve-lh-relaxed': '1.85',
      '--shell-nav-width': '280px',
      '--shell-nav-rail-width': '56px',
      '--shell-topbar-height': '56px',
      '--deck-header-height': '44px',
      '--deck-gutter-width': '8px',
    },
  },

  'monospace': {
    name: 'monospace',
    label: 'Monospace',
    description: 'Mono font everywhere, terminal aesthetic',
    overrides: {
      '--font-sans': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      '--font-display': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      '--nerve-font-xs': '0.6rem',
      '--nerve-font-sm': '0.667rem',
      '--nerve-font-md': '0.733rem',
      '--nerve-font-base': '0.8rem',
      '--nerve-font-lg': '0.867rem',
      '--nerve-lh-normal': '1.5',
      '--nerve-lh-relaxed': '1.6',
      '--nerve-heading-weight': '700',
      '--nerve-heading-spacing': '0',
      '--radius': '0.333rem',
      '--shell-gap': '8px',
      '--shell-pad': '8px',
      '--panel-pad': '10px',
      '--panel-gap': '2px',
    },
  },

  'editor': {
    name: 'editor',
    label: 'Editor',
    description: 'Optimized for code viewing — wider chat area, larger code blocks',
    overrides: {
      '--nerve-content-gap': '0.9em',
      '--nerve-chat-max-width': 'min(1280px, 88%)',
      '--nerve-font-base': '0.933rem',
      '--nerve-lh-relaxed': '1.75',
      '--nerve-row-gap': '12px',
      '--shell-nav-width': '240px',
      '--shell-nav-rail-width': '48px',
    },
  },

  'high-contrast': {
    name: 'high-contrast',
    label: 'High Contrast',
    description: 'WCAG AAA compliant, maximum readability',
    overrides: {
      '--radius': '0.533rem',
      '--nerve-font-xs': '0.733rem',
      '--nerve-font-sm': '0.8rem',
      '--nerve-font-md': '0.867rem',
      '--nerve-font-base': '1rem',
      '--nerve-font-lg': '1.133rem',
      '--nerve-lh-normal': '1.65',
      '--nerve-lh-relaxed': '1.85',
      '--nerve-heading-weight': '700',
    },
  },

  'glassmorphism': {
    name: 'glassmorphism',
    label: 'Glassmorphism',
    description: 'Translucent panels, blur effects, soft shadows',
    overrides: {
      '--radius': '1.333rem',
      '--shadow-card': '0 8px 32px rgba(0, 0, 0, 0.12)',
      '--shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.15)',
      '--shadow-xl': '0 16px 48px rgba(0, 0, 0, 0.2)',
      '--shadow-glow': '0 0 24px rgba(0, 0, 0, 0.08)',
      '--shell-gap': '16px',
      '--shell-pad': '16px',
      '--panel-pad': '16px',
      '--panel-gap': '10px',
      '--deck-gutter-width': '10px',
    },
  },
};

export const layoutTemplateNames = Object.keys(layoutTemplates) as (keyof typeof layoutTemplates)[];

/**
 * Compose a layout template's overrides on top of a theme's colors.
 * Returns the merged CSS variable map ready for applyTheme().
 */
export function composeWithLayout(
  themeColors: Record<string, string>,
  layoutName: string | null
): Record<string, string> {
  if (!layoutName || layoutName === 'default' || !layoutTemplates[layoutName]) {
    return { ...themeColors };
  }
  
  const layout = layoutTemplates[layoutName];
  return {
    ...themeColors,
    ...layout.overrides,
  };
}

/**
 * Apply layout template overrides to document.documentElement.
 * Only sets the variables defined in the template; others remain unchanged.
 */
export function applyLayoutTemplate(templateName: string | null): void {
  const root = document.documentElement;
  
  // Clear any previously applied layout template variables
  // We track which vars we set so we can remove them on switch
  const previouslyApplied = root.dataset.appliedLayoutVars;
  if (previouslyApplied) {
    const vars = previouslyApplied.split(',');
    for (const v of vars) {
      root.style.removeProperty(v);
    }
    delete root.dataset.appliedLayoutVars;
  }
  
  if (!templateName || templateName === 'default' || !layoutTemplates[templateName]) {
    return;
  }
  
  const layout = layoutTemplates[templateName];
  const appliedVars: string[] = [];
  
  for (const [property, value] of Object.entries(layout.overrides)) {
    root.style.setProperty(property, value);
    appliedVars.push(property);
  }
  
  root.dataset.appliedLayoutVars = appliedVars.join(',');
}