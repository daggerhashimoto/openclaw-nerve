/**
 * CodeMirror theme matching the Nerve dark UI.
 *
 * Uses CSS custom properties from the app's theme system so it
 * automatically adapts to whatever theme is active.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export const nerveTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--foreground)',
      fontSize: 'var(--editor-font-size, 13px)',
      fontFamily: 'var(--font-mono)',
      height: '100%',
    },
    '.cm-content': {
      padding: '8px 0',
      caretColor: 'var(--primary)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--primary)',
      borderLeftWidth: '2px',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'color-mix(in srgb, var(--muted-foreground) 50%, transparent)',
      borderRight: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
      minWidth: '40px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--muted) 40%, transparent)',
      color: 'var(--muted-foreground)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--muted) 25%, transparent)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
      },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--chart-4) 30%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--chart-4) 50%, transparent)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--chart-4) 50%, transparent)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--background)',
      color: 'var(--foreground)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--border)',
    },
    '.cm-panel.cm-search': {
      padding: '6px 8px',
      gap: '4px',
    },
    '.cm-panel.cm-search input': {
      fontSize: 'var(--editor-font-size, 13px)',
      padding: '2px 6px',
      borderRadius: '4px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--background)',
      color: 'var(--foreground)',
    },
    '.cm-panel.cm-search button': {
      fontSize: 'var(--editor-font-size, 13px)',
      padding: '2px 8px',
      borderRadius: '4px',
      cursor: 'pointer',
      backgroundColor: 'color-mix(in srgb, var(--muted) 60%, transparent)',
      color: 'var(--foreground)',
      border: '1px solid var(--border)',
    },
    '.cm-panel.cm-search button:hover': {
      backgroundColor: 'var(--muted)',
    },
    '.cm-panel.cm-search button[name="close"]': {
      fontSize: 'var(--editor-font-size, 13px)',
      padding: '2px 8px',
      fontWeight: 'bold',
    },
    '.cm-panel.cm-search label': {
      fontSize: 'var(--editor-font-size, 13px)',
      color: 'var(--muted-foreground)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      border: '1px solid var(--border)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'color-mix(in srgb, var(--muted) 50%, transparent)',
      border: 'none',
      color: 'var(--muted-foreground)',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
  },
  { dark: true },
);

/** Syntax highlighting colors for the Nerve theme. */
export const nerveHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: '#c678dd' },
    { tag: [t.name, t.deleted, t.character, t.macroName], color: '#e06c75' },
    { tag: [t.function(t.variableName), t.labelName], color: '#61afef' },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#d19a66' },
    { tag: [t.definition(t.name), t.separator], color: '#abb2bf' },
    { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#e5c07b' },
    { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#56b6c2' },
    { tag: [t.meta, t.comment], color: '#5c6370', fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: '#61afef', textDecoration: 'underline' },
    { tag: t.heading, fontWeight: 'bold', color: '#e06c75' },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#d19a66' },
    { tag: [t.processingInstruction, t.string, t.inserted], color: '#98c379' },
    { tag: t.invalid, color: '#ff0000' },
  ]),
);
