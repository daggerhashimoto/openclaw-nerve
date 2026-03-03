/**
 * highlight.ts — Syntax highlighting via highlight.js (tree-shakeable core).
 *
 * Registers a curated set of languages and provides helpers for
 * code-fence language ↔ file-extension mapping and highlighting.
 */
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';

// Single registration point for all highlight.js languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);

export { hljs };

// ─── Code-fence language ↔ file extension mapping ───────────────────────────

/** Map code-fence language identifiers to file extensions */
const LANG_EXT_MAP: Record<string, string> = {
  typescript: 'ts', tsx: 'tsx', javascript: 'js', jsx: 'jsx',
  python: 'py', ruby: 'rb', rust: 'rs', golang: 'go', go: 'go',
  java: 'java', kotlin: 'kt', swift: 'swift', csharp: 'cs',
  cpp: 'cpp', 'c++': 'cpp', c: 'c', objectivec: 'm', perl: 'pl', php: 'php',
  lua: 'lua', r: 'r', scala: 'scala', haskell: 'hs', elixir: 'ex',
  erlang: 'erl', clojure: 'clj', dart: 'dart', zig: 'zig',
  html: 'html', css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  json: 'json', yaml: 'yaml', yml: 'yml', toml: 'toml', xml: 'xml',
  markdown: 'md', mdx: 'mdx', tex: 'tex', latex: 'tex', graphql: 'graphql',
  sql: 'sql', bash: 'sh', shell: 'sh', sh: 'sh', zsh: 'zsh',
  'shell-session': 'sh', text: 'txt', plain: 'txt', plaintext: 'txt',
  powershell: 'ps1', fish: 'fish', dockerfile: 'Dockerfile',
  makefile: 'Makefile', cmake: 'cmake', nginx: 'conf', apache: 'conf',
  ini: 'ini', properties: 'properties', diff: 'diff', patch: 'patch',
  protobuf: 'proto', thrift: 'thrift', solidity: 'sol',
  wasm: 'wasm', assembly: 'asm', nasm: 'asm', mips: 'asm',
  vhdl: 'vhdl', verilog: 'v', systemverilog: 'sv',
  conf: 'conf', cfg: 'cfg', env: 'env',
};

/** Build reverse map: file extension → language (first match wins) */
const EXT_LANG_MAP: Record<string, string> = {};
for (const [lang, ext] of Object.entries(LANG_EXT_MAP)) {
  // Only set if not already mapped (first lang wins for each ext)
  if (!EXT_LANG_MAP[ext]) {
    EXT_LANG_MAP[ext] = lang;
  }
}
// Overrides where the reverse default isn't ideal
EXT_LANG_MAP['ts'] = 'typescript';
EXT_LANG_MAP['js'] = 'javascript';
EXT_LANG_MAP['py'] = 'python';
EXT_LANG_MAP['rb'] = 'ruby';
EXT_LANG_MAP['rs'] = 'rust';
EXT_LANG_MAP['sh'] = 'bash';
EXT_LANG_MAP['md'] = 'markdown';
EXT_LANG_MAP['h'] = 'c';
EXT_LANG_MAP['m'] = 'objectivec';
EXT_LANG_MAP['vue'] = 'xml';
EXT_LANG_MAP['svelte'] = 'xml';
// Extensionless filenames (lowercase for detectLanguage lookup)
EXT_LANG_MAP['dockerfile'] = 'dockerfile';
EXT_LANG_MAP['makefile'] = 'makefile';

/** Get file extension for a code-fence language identifier */
export function getExtension(lang: string): string {
  if (!lang) return 'txt';
  const lower = lang.toLowerCase();
  return LANG_EXT_MAP[lower] || lower;
}

/** Detect highlight.js language from a file path */
export function detectLanguage(filePath?: string): string {
  if (!filePath) return '';
  const filename = filePath.split('/').pop() || '';
  // Check full filename first (Dockerfile, Makefile, etc.)
  const byName = EXT_LANG_MAP[filename.toLowerCase()];
  if (byName) return byName;
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG_MAP[ext] || '';
}

// ─── Highlighting ────────────────────────────────────────────────────────────

/** Highlight code with optional language hint. Returns HTML string. */
export function highlightCode(code: string, lang: string): string {
  if (!lang || !code) return escapeHtml(code);
  const unescaped = code
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  try {
    if (hljs.getLanguage(lang)) {
      return hljs.highlight(unescaped, { language: lang }).value;
    }
    // Language specified but not registered — return escaped, don't auto-detect
    return escapeHtml(code);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
