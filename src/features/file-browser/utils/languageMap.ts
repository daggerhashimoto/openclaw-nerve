import type { Extension } from '@codemirror/state';

type LanguageLoader = () => Promise<Extension>;

const LANG_MAP: Record<string, LanguageLoader> = {
  '.md': () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  '.json': () => import('@codemirror/lang-json').then((m) => m.json()),
  '.ts': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ typescript: true }),
    ),
  '.tsx': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ typescript: true, jsx: true }),
    ),
  '.js': () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript()),
  '.jsx': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true }),
    ),
  '.yaml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  '.yml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  '.css': () => import('@codemirror/lang-css').then((m) => m.css()),
  '.html': () => import('@codemirror/lang-html').then((m) => m.html()),
  '.htm': () => import('@codemirror/lang-html').then((m) => m.html()),
  '.py': () => import('@codemirror/lang-python').then((m) => m.python()),
  '.sh': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/shell'),
      import('@codemirror/language'),
    ]).then(([shell, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(shell.shell)),
    ),
  '.bash': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/shell'),
      import('@codemirror/language'),
    ]).then(([shell, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(shell.shell)),
    ),
  '.zsh': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/shell'),
      import('@codemirror/language'),
    ]).then(([shell, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(shell.shell)),
    ),
  '.rb': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/ruby'),
      import('@codemirror/language'),
    ]).then(([ruby, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(ruby.ruby)),
    ),
  '.pl': () =>
    Promise.all([
      import('@codemirror/legacy-modes/mode/perl'),
      import('@codemirror/language'),
    ]).then(([perl, lang]) =>
      new lang.LanguageSupport(lang.StreamLanguage.define(perl.perl)),
    ),
};

/** Shebang regex → LANG_MAP key (checked in order) */
const SHEBANG_TO_EXT: Array<[RegExp, string]> = [
  [/\bpython[23]?\b/, '.py'],
  [/\b(bash|sh|zsh|fish)\b/, '.sh'],
  [/\bruby\b/, '.rb'],
  [/\bperl\b/, '.pl'],
  [/\bts-node\b/, '.ts'],
  [/\btsx\b/, '.tsx'],
  [/\b(node|nodejs|deno|bun)\b/, '.js'],
];

export function resolveLanguageExtensionKey(filename: string, content?: string): string {
  let ext = filename.includes('.')
    ? '.' + filename.split('.').pop()!.toLowerCase()
    : '';
  if (!LANG_MAP[ext] && content) {
    const firstLine = content.slice(0, content.indexOf('\n')).trim();
    if (firstLine.startsWith('#!')) {
      for (const [re, mappedExt] of SHEBANG_TO_EXT) {
        if (re.test(firstLine)) { ext = mappedExt; break; }
      }
    }
  }
  return LANG_MAP[ext] ? ext : '';
}

/** Resolve a CodeMirror language extension for the given filename (and optionally file content for shebang fallback). */
export async function getLanguageExtension(
  filename: string,
  content?: string,
): Promise<Extension | null> {
  const ext = resolveLanguageExtensionKey(filename, content);
  const loader = LANG_MAP[ext];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

/** Whether the given filename should use line wrapping. */
export function shouldWrap(filename: string): boolean {
  const ext = filename.includes('.')
    ? '.' + filename.split('.').pop()!.toLowerCase()
    : '';
  return ext === '.md' || ext === '.txt' || ext === '';
}
