/**
 * CodeMirror theme for Nerve's night and daylight worlds.
 *
 * Chrome reads the app's --color-* tokens, so it follows whichever theme is
 * active. Syntax colours are CSS variables defined on the editor root, with a
 * daylight override keyed off html[data-theme="light"]; they match
 * public/hljs/nerve-dark.min.css and nerve-light.min.css and stay off
 * electric blue and cantaloupe, which carry live and operator state.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** Syntax palette per world (same hues as the vendored highlight.js themes). */
const nightSyntax = {
  '--cm-syn-keyword': '#B9A7FF',
  '--cm-syn-title': '#7FD1C7',
  '--cm-syn-literal': '#E6B8D3',
  '--cm-syn-string': '#A8D8A0',
  '--cm-syn-builtin': '#D9CFAF',
  '--cm-syn-comment': '#6E7689',
  '--cm-syn-heading': '#ECE6DA',
  '--cm-syn-deleted': '#FFB0AA',
} as const;

const daylightSyntax = {
  '--cm-syn-keyword': '#5B3FC4',
  '--cm-syn-title': '#0D6F69',
  '--cm-syn-literal': '#97306B',
  '--cm-syn-string': '#2B6B3C',
  '--cm-syn-builtin': '#6E5410',
  '--cm-syn-comment': '#737B8C',
  '--cm-syn-heading': '#131722',
  '--cm-syn-deleted': '#9B2320',
} as const;

const raisedTint = 'color-mix(in srgb, var(--color-raised) 70%, transparent)';
const neutralMark = 'color-mix(in srgb, var(--color-foreground) 14%, transparent)';
const neutralMarkStrong = 'color-mix(in srgb, var(--color-foreground) 26%, transparent)';
const operatorSelection = 'color-mix(in srgb, var(--color-operator) 30%, transparent)';

export const nerveTheme = EditorView.theme(
  {
    '&': {
      ...nightSyntax,
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-foreground)',
      fontSize: 'var(--editor-font-size, 13px)',
      fontFamily: 'var(--font-mono)',
      height: '100%',
    },
    'html[data-theme="light"] &': {
      ...daylightSyntax,
    },
    '.cm-content': {
      padding: '8px 0',
      caretColor: 'var(--color-operator)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-operator)',
      borderLeftWidth: '2px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-muted-foreground)',
      borderRight: '1px solid var(--color-border)',
      minWidth: '40px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: raisedTint,
      color: 'var(--color-foreground)',
    },
    '.cm-activeLine': {
      backgroundColor: raisedTint,
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: operatorSelection,
      },
    '.cm-selectionMatch': {
      backgroundColor: neutralMark,
    },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: neutralMarkStrong,
      color: 'var(--color-foreground)',
    },
    '&.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--color-destructive) 22%, transparent)',
    },
    '.cm-searchMatch': {
      backgroundColor: neutralMark,
      outline: `1px solid ${neutralMarkStrong}`,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: neutralMarkStrong,
    },
    '.cm-panels': {
      backgroundColor: 'var(--color-card)',
      color: 'var(--color-foreground)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--color-border)',
    },
    '.cm-panels.cm-panels-bottom': {
      borderTop: '1px solid var(--color-border)',
    },
    '.cm-panel.cm-search': {
      padding: '6px 8px',
      gap: '4px',
      fontFamily: 'var(--font-sans)',
    },
    '.cm-panel.cm-search input': {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--editor-font-size, 13px)',
      padding: '2px 6px',
      borderRadius: '3px',
      border: '1px solid var(--color-input)',
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-foreground)',
    },
    '.cm-panel.cm-search input[type="checkbox"]': {
      accentColor: 'var(--color-foreground)',
    },
    '.cm-panel.cm-search button': {
      fontFamily: 'var(--font-sans)',
      fontSize: '0.8rem',
      padding: '2px 8px',
      borderRadius: '3px',
      cursor: 'pointer',
      backgroundColor: 'var(--color-raised)',
      backgroundImage: 'none',
      color: 'var(--color-foreground)',
      border: '1px solid var(--color-border)',
    },
    '.cm-panel.cm-search button:hover': {
      backgroundColor: 'var(--color-border)',
    },
    '.cm-panel.cm-search button[name="close"]': {
      fontSize: 'var(--editor-font-size, 13px)',
      padding: '2px 8px',
      fontWeight: 'normal',
      color: 'var(--color-muted-foreground)',
      backgroundColor: 'transparent',
      border: '1px solid transparent',
    },
    '.cm-panel.cm-search button[name="close"]:hover': {
      color: 'var(--color-foreground)',
      backgroundColor: 'var(--color-raised)',
    },
    '.cm-panel.cm-search label': {
      fontSize: '0.8rem',
      color: 'var(--color-muted-foreground)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-popover)',
      color: 'var(--color-popover-foreground)',
      border: '1px solid var(--color-border)',
      borderRadius: '3px',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-raised)',
      border: '1px solid var(--color-border)',
      borderRadius: '2px',
      color: 'var(--color-muted-foreground)',
    },
    '.cm-foldGutter .cm-gutterElement': {
      color: 'var(--color-muted-foreground)',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  },
  { dark: true },
);

const syn = (name: keyof typeof nightSyntax) => `var(${name}, ${nightSyntax[name]})`;

/** Syntax highlighting colours for the Nerve theme (night and daylight via CSS variables). */
export const nerveHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.modifier], color: syn('--cm-syn-keyword') },
    { tag: [t.self, t.special(t.variableName), t.typeName], color: syn('--cm-syn-keyword') },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName, t.className], color: syn('--cm-syn-title') },
    { tag: [t.tagName, t.quote], color: syn('--cm-syn-title') },
    { tag: [t.number, t.bool, t.atom, t.null, t.color, t.unit, t.constant(t.name)], color: syn('--cm-syn-literal') },
    { tag: [t.propertyName, t.attributeName, t.operator, t.meta, t.annotation, t.macroName], color: syn('--cm-syn-literal') },
    { tag: [t.string, t.special(t.string), t.character, t.regexp, t.processingInstruction, t.inserted], color: syn('--cm-syn-string') },
    { tag: [t.standard(t.name), t.escape, t.list, t.namespace, t.changed], color: syn('--cm-syn-builtin') },
    { tag: [t.url, t.link], color: syn('--cm-syn-title'), textDecoration: 'underline' },
    { tag: t.comment, color: syn('--cm-syn-comment'), fontStyle: 'italic' },
    { tag: t.heading, fontWeight: 'bold', color: syn('--cm-syn-heading') },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.deleted, color: syn('--cm-syn-deleted') },
    { tag: t.invalid, color: 'var(--color-destructive)' },
  ]),
);
