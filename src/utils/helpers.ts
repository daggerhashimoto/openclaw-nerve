/**
 * helpers.ts — markdown rendering, content extraction, and tool descriptions
 * 
 * For formatting utilities, import directly from:
 *   - @/lib/formatting (esc, timeAgo, fmtTokens, fmtK)
 *   - @/features/voice/audio-feedback (playPing, playWakePing, etc.)
 */
import { esc } from '@/lib/formatting';
import type { ContentBlock } from '@/types';

// ─── Markdown cache ───
const MD_CACHE_MAX = 200;
const markdownCache = new Map<string, string>();

function getMarkdownCache(key: string): string | undefined {
  const val = markdownCache.get(key);
  if (!val) return undefined;
  markdownCache.delete(key);
  markdownCache.set(key, val);
  return val;
}

function setMarkdownCache(key: string, value: string): void {
  markdownCache.set(key, value);
  if (markdownCache.size > MD_CACHE_MAX) {
    const oldestKey = markdownCache.keys().next().value;
    if (oldestKey) markdownCache.delete(oldestKey);
  }
}

/**
 * A fenced code block: a run of three or more backticks and an optional
 * language, closed by a run at least as long. A shorter run inside, such as a
 * triple fence in a tool result fenced with four, is part of the code.
 */
const FENCED_BLOCK = /(?<!`)(`{3,})(\w*)\n([\s\S]*?)(?<!`)\1`*/g;
const INLINE_CODE = /`([^`]+)`/g;
/** A set-aside code span. Escaped text has no `<` (esc turns it into &lt;), so this cannot collide. */
const SET_ASIDE = /<(\d+)>/g;

/**
 * Lightweight regex-based markdown renderer for streaming and tool results.
 *
 * Supports fenced code blocks, inline code, bold, italic, links, and unordered
 * lists. Code is set aside before the other substitutions, so what is inside it
 * (a streamed tool result, for one) stays verbatim. Rich syntax highlighting
 * lives in lazy-rendered markdown and diff components so chat runtime
 * projection does not pull highlight.js into the initial bundle. Results are
 * cached (LRU, max 200).
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  const cacheKey = 'nh:' + text;
  const cached = getMarkdownCache(cacheKey);
  if (cached) return cached;

  const code: string[] = [];
  const setAside = (html: string) => `<${code.push(html) - 1}>`;

  let s = esc(text);
  s = s.replace(FENCED_BLOCK, (_, _fence, lang, body) => {
    const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
    return setAside(`<pre class="hljs">${langLabel}<code>${body}</code></pre>`);
  });
  s = s.replace(INLINE_CODE, (_, body: string) => setAside(`<code>${body.replace(/\n/g, '<br>')}</code>`));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)<]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/^[-*] (.+)$/gm, '• $1');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(SET_ASIDE, (_, index: string) => code[Number(index)] ?? '');

  setMarkdownCache(cacheKey, s);
  return s;
}

/** A content block that calls a tool (`toolCall` from OpenClaw, `tool_use` from Anthropic-style transcripts). */
export function isToolCallBlock(block: ContentBlock): boolean {
  return block.type === 'toolCall' || block.type === 'tool_use';
}

/** A content block that carries a tool's result (`toolResult` or `tool_result`). */
export function isToolResultBlock(block: ContentBlock): boolean {
  return block.type === 'toolResult' || block.type === 'tool_result';
}

/** The plain text of a tool result block: its text, its text blocks joined, or its structured value as JSON. */
export function toolResultText(block: ContentBlock): string {
  const { content } = block;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
  }
  if (content === undefined || content === null) return block.text ?? '';
  return JSON.stringify(content);
}

/** A tool result as a fenced block whose fence is longer than any backtick run inside it, so it stays verbatim. */
function fencedToolResult(text: string): string {
  const longestRun = (text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `**tool result:**\n${fence}\n${text || '(empty result)'}\n${fence}`;
}

/**
 * Extract the text of a chat message, including tool call/result blocks.
 *
 * The transcript shows tool blocks as tool rows (splitToolCallMessage); this
 * text serves filters, the streaming preview, speech and copy, so a tool result
 * is a fenced block and never a marker a renderer has to find again.
 */
export function extractText(msg: { role: string; content: string | ContentBlock[]; text?: string }): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) parts.push(block.text);
      else if (isToolCallBlock(block)) {
        const toolInput = block.input || block.arguments;
        parts.push(`**tool:** \`${block.name}\`\n\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``);
      } else if (isToolResultBlock(block)) {
        parts.push(fencedToolResult(toolResultText(block)));
      }
    }
    return parts.join('\n');
  }
  return msg.text || '';
}

// ─── Path sanitization helpers ───
function sanitizePath(path: string): string {
  // Replace /root/ with ~/, /home/user/ with ~/, or just use basename
  const str = String(path);
  if (str.startsWith('/root/')) return str.replace('/root/', '~/');
  if (str.match(/^\/home\/[^/]+\//)) return str.replace(/^\/home\/[^/]+\//, '~/');
  // For absolute paths that don't start with home/root, just use basename
  if (str.startsWith('/')) return str.split('/').pop() || str;
  return str;
}

function redactSecrets(cmd: string): string {
  // Redact common secret patterns in exec commands
  let safe = cmd;
  // Redact -H "Authorization: ..." or -H 'Authorization: ...'
  safe = safe.replace(/-H\s+["']Authorization:\s*[^"']+["']/gi, '-H "Authorization: [REDACTED]"');
  // Redact token=xxx, api_key=xxx, password=xxx
  safe = safe.replace(/\b(token|api_key|password|secret|auth)=[^\s&]+/gi, '$1=[REDACTED]');
  // Redact Bearer tokens
  safe = safe.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  return safe;
}

/**
 * Extract a short project name from a working directory path.
 * Returns the last meaningful path segment, or null for generic/root paths.
 */
export function extractProjectName(workdir: string | undefined | null): string | null {
  if (!workdir) return null;
  const trimmed = workdir.replace(/\/+$/, '');
  if (!trimmed || trimmed === '/' || trimmed === '/root' || trimmed === '/tmp') return null;
  const seg = trimmed.split('/').pop() || null;
  // Skip generic names
  if (!seg || seg === 'workspace' || seg === 'home' || seg === '~') return null;
  return seg;
}

/** Append project context suffix if available. */
function withProject(desc: string, project: string | null): string {
  return project ? `${desc} (${project})` : desc;
}

// ─── Reading shell commands ───

/** The command a call ran, from a string or an argument list such as `['bash', '-lc', 'cat x']`. */
function commandText(p: Record<string, unknown>): string {
  const raw = p.command ?? p.cmd;
  if (Array.isArray(raw)) {
    const parts = raw.map(String);
    if (parts.length >= 3 && /(^|\/)(ba|z)?sh$/.test(parts[0]) && /^-l?c$/.test(parts[1])) return parts[2];
    return parts.join(' ');
  }
  return typeof raw === 'string' ? raw : '';
}

/** `bash -lc '...'` (sh or zsh, any path) only wraps the command; the one inside is what ran. */
function unwrapShell(cmd: string): string {
  const m = cmd.match(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1\s*$/);
  if (!m) {
    // Unquoted: `bash -lc pwd`
    const bare = cmd.match(/^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+([^\s'"]+)\s*$/);
    return bare ? bare[1] : cmd;
  }
  const inner = m[1] === '"' ? m[2].replace(/\\(["\\$`])/g, '$1') : m[2].replace(/'\\''/g, "'");
  return inner.trim();
}

/** The pipeline, `&&`, `||` and `;` segments of a command, split outside quotes. */
function commandSegments(cmd: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < cmd.length) { current += ch + cmd[++i]; continue; }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '|' || ch === ';' || (ch === '&' && cmd[i + 1] === '&')) {
      segments.push(current.trim());
      current = '';
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) i++;
      continue;
    }
    current += ch;
  }
  segments.push(current.trim());
  return segments.filter(Boolean);
}

/** A segment split into words, with quotes removed (enough to find a pattern, a path or a URL). */
function shellWords(segment: string): string[] {
  const words: string[] = [];
  for (const m of segment.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)) {
    words.push(m[1] ?? (m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]));
  }
  return words;
}

/** The first operand after the flags, skipping the values of flags that take one. */
function firstOperand(words: string[], valueFlags: ReadonlySet<string>): string | undefined {
  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if (word === '-e' || word === '--regexp') return words[i + 1];
    if (word.startsWith('-') && word.length > 1) {
      if (valueFlags.has(word)) i++;
      continue;
    }
    return word;
  }
  return undefined;
}

const SEARCH_VALUE_FLAGS = new Set([
  '-A', '-B', '-C', '-m', '-g', '-t', '-T', '-d', '-f', '--glob', '--type', '--type-not',
  '--max-count', '--max-depth', '--context', '--after-context', '--before-context',
]);
const READ_VALUE_FLAGS = new Set(['-n', '-c']);
const FIND_NAME_FLAGS = new Set(['-name', '-iname', '-path', '-ipath', '-regex']);

/** A URL as host and path, without the scheme or a leading www. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return (parsed.host.replace(/^www\./, '') + parsed.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * What a file search, find, read or fetch is about, from its first real
 * segment; null when the segment is some other command.
 */
function describeShellSegment(words: string[]): string | null {
  const tool = words[0]?.split('/').pop();
  if (tool === 'rg' && words.includes('--files')) {
    // `rg --files -g 'AGENTS.md' -g 'SOUL.md'` lists files by name instead of searching their text
    const globs = words.flatMap((w, i) => ((w === '-g' || w === '--glob') && words[i + 1] ? [words[i + 1]] : []));
    return globs.length > 0 ? 'finding files: ' + globs.join(', ') : 'listing files';
  }
  if (tool === 'grep' || tool === 'rg' || tool === 'egrep' || tool === 'ag') {
    const pattern = firstOperand(words, SEARCH_VALUE_FLAGS);
    return pattern ? 'searching files: ' + pattern : 'searching files';
  }
  if (tool === 'find' || tool === 'fd') {
    const flag = words.findIndex((w) => FIND_NAME_FLAGS.has(w));
    if (flag > 0 && words[flag + 1]) return 'finding files: ' + words[flag + 1];
    const where = firstOperand(words, new Set());
    if (tool === 'fd' && where) return 'finding files: ' + where;
    return where && where !== '.' ? 'finding files in ' + sanitizePath(where) : 'finding files';
  }
  if (tool === 'python' || tool === 'python3') {
    const script = words[1];
    return script && /\.py$/.test(script) ? 'running ' + sanitizePath(script) : 'running python script';
  }
  if (tool === 'cat' || tool === 'head' || tool === 'tail' || tool === 'less' || tool === 'bat' || tool === 'nl') {
    const file = firstOperand(words, READ_VALUE_FLAGS);
    return file ? 'reading ' + sanitizePath(file) : 'reading file';
  }
  if (tool === 'sed' && words.includes('-n') && words.length >= 4) {
    const file = words[words.length - 1];
    if (!file.startsWith('-')) return 'reading ' + sanitizePath(file);
  }
  if (tool === 'curl' || tool === 'wget') {
    const url = words.find((w) => /^https?:\/\//.test(w));
    if (url) {
      try { return 'fetching ' + new URL(url).host; } catch { /* fall through */ }
    }
    return 'fetching URL';
  }
  return null;
}

/** Codex code mode runs a script of tool calls; name what the script runs or searches for. */
function describeToolScript(script: string): string {
  const literal = (quoted: string) => {
    if (quoted.startsWith('"')) {
      try { return JSON.parse(quoted) as string; } catch { /* fall through */ }
    }
    return quoted.slice(1, -1).replace(/\\(.)/g, '$1');
  };
  const stringLiteral = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;
  const commands = [...script.matchAll(new RegExp(String.raw`exec_command\(\s*\{[^}]*?\bcmd\s*:\s*` + stringLiteral, 'g'))]
    .map((m) => literal(m[1]));
  const queries = [...script.matchAll(new RegExp(String.raw`[{,\s]["']?q["']?\s*:\s*` + stringLiteral, 'g'))]
    .map((m) => literal(m[1]));
  // web__run({find:[{ref_id, pattern}]}) looks for text in an opened page; open:[{ref_id}] opens one
  const finds = [...script.matchAll(new RegExp(String.raw`["']?pattern["']?\s*:\s*` + stringLiteral, 'g'))]
    .map((m) => literal(m[1]));
  const opens = /\bopen\s*:\s*\[/.test(script)
    ? [...script.matchAll(new RegExp(String.raw`["']?ref_id["']?\s*:\s*` + stringLiteral, 'g'))].map((m) => literal(m[1]))
    : [];
  // write_stdin talks to a command still running: empty input just checks on it
  const stdin = [...script.matchAll(new RegExp(String.raw`write_stdin\(\s*\{[^}]*?\bchars\s*:\s*` + stringLiteral, 'g'))]
    .map((m) => literal(m[1]));
  const total = commands.length + queries.length + finds.length + opens.length + stdin.length;
  const more = total > 1 ? ` and ${total - 1} more` : '';
  if (commands.length > 0) return (describeToolUse('exec', { command: commands[0] }) || 'running command') + more;
  if (queries.length > 0) return 'searching: ' + queries[0] + more;
  if (finds.length > 0) return 'finding in page: ' + finds[0] + more;
  if (opens.length > 0) return 'opening ' + shortUrl(opens[0]) + more;
  if (stdin.length > 0) return (stdin[0] ? 'sending input to a running command' : 'checking on a running command') + more;
  return 'running script';
}

/**
 * Generate a short human-readable description for a tool invocation.
 * Used in the agent activity log. Returns `null` if tool name is empty.
 */
export function describeToolUse(toolName: string, input: Record<string, unknown>): string | null {
  if (!toolName) return null;
  const p = input || {};
  const tn = toolName.toLowerCase();
  switch (tn) {
    case 'bash':
    case 'exec':
    case 'exec_command': {
      let cmd = unwrapShell(commandText(p).trim());
      if (!cmd) {
        // Codex code mode: the call is a script of tool calls, not a command line
        if (typeof p.input === 'string' && p.input.trim()) return describeToolScript(p.input);
        return 'running command';
      }

      // Redact secrets before processing
      cmd = redactSecrets(cmd);
      const project = extractProjectName((p.workdir || p.cwd) as string);
      const segments = commandSegments(cmd);
      // A leading `cd somewhere &&` only sets the scene; describe the command that does the work
      const short = segments.find((segment) => !/^cd(\s|$)/.test(segment)) ?? segments[0] ?? cmd;

      if (cmd.includes('npm install') || cmd.includes('pip install') || cmd.includes('apt install') || cmd.includes('apt-get install'))
        return withProject('installing: ' + cmd.replace(/.*install\s+(-\w+\s+)*/, '').split(/\s/)[0], project);
      if (cmd.includes('bunx ')) return withProject('running: ' + (cmd.match(/bunx\s+(\S+)/)?.[1] || cmd.slice(0, 40)), project);
      if (/^(curl|wget)\s/.test(short)) return describeShellSegment(shellWords(short)) || 'fetching URL';
      if (cmd.includes('pkill') || cmd.includes('kill ')) return 'stopping process';
      if (cmd.includes('git ')) return withProject('git ' + cmd.replace(/.*git\s+/, '').split(/\s/)[0], project);
      if (cmd.startsWith('cd ') && cmd.includes('node ')) return 'restarting server';
      if (cmd.includes('npm run build')) return withProject('building', project);
      if (cmd.includes('npm run lint')) return withProject('linting', project);
      if (cmd.includes('npm run ')) {
        const script = cmd.match(/npm run\s+(\S+)/)?.[1] || '';
        return withProject('npm run ' + script, project);
      }
      const segmentDescription = describeShellSegment(shellWords(short));
      if (segmentDescription) return withProject(segmentDescription, project);
      if (/^(systemctl|service)\s/.test(short)) {
        const svcMatch = short.match(/(?:systemctl|service)\s+(\w+)\s+(\S+)/);
        if (svcMatch) {
          const actionMap: Record<string, string> = {
            start: 'starting', stop: 'stopping', restart: 'restarting',
            status: 'checking', show: 'checking', enable: 'enabling', disable: 'disabling',
          };
          const verb = actionMap[svcMatch[1]] || svcMatch[1];
          return `${verb} service: ${svcMatch[2]}`;
        }
      }
      return project ? `${project}: ${short}` : 'exec: ' + short;
    }
    case 'read': return 'reading ' + sanitizePath(String(p.path || p.file_path || 'file'));
    case 'write': return 'writing ' + sanitizePath(String(p.path || p.file_path || 'file'));
    case 'edit': return 'editing ' + sanitizePath(String(p.path || p.file_path || 'file'));
    case 'apply_patch': {
      // Codex harness edits: one call may touch several files; name them with their line counts
      const changes = Array.isArray(p.changes) ? (p.changes as Array<Record<string, unknown>>) : [];
      if (changes.length === 0) return 'editing files';
      const parts = changes.slice(0, 3).map((change) => {
        const name = sanitizePath(String(change.path || 'file')).split('/').pop() || 'file';
        const stat = change.stat as { added?: number; removed?: number } | undefined;
        const counts = stat && (stat.added || stat.removed) ? ` +${stat.added ?? 0} -${stat.removed ?? 0}` : '';
        return name + counts;
      });
      const more = changes.length > 3 ? ` and ${changes.length - 3} more` : '';
      return 'editing ' + parts.join(', ') + more;
    }
    case 'web_search': {
      // Codex reports a search before it knows the query ({ queryUnavailable: true });
      // the query, or the page it opened, comes with the result.
      if (p.action === 'findInPage' && typeof p.pattern === 'string' && p.pattern) return 'finding in page: ' + p.pattern;
      if (typeof p.url === 'string' && p.url && p.action && p.action !== 'search') return 'opening ' + shortUrl(p.url);
      const queries = Array.isArray(p.queries) ? p.queries.map(String).filter(Boolean) : [];
      const query = queries[0] || (typeof p.query === 'string' ? p.query.trim() : '');
      if (!query) return 'searching the web';
      return 'searching: ' + query + (queries.length > 1 ? ` and ${queries.length - 1} more` : '');
    }
    case 'web_fetch': return 'fetching: ' + String(p.url || '').replace(/https?:\/\/(www\.)?/, '').split('/')[0];
    case 'sessions_spawn': return 'spawning sub-agent: ' + String(p.label || (typeof p.task === 'string' ? p.task : '') || 'task');
    case 'sessions_list': return 'listing sessions';
    case 'sessions_send': return 'messaging session';
    case 'sessions_search': return p.query ? 'searching sessions: ' + String(p.query) : 'searching sessions';
    case 'agents_list': return 'listing agents';
    case 'openclaw': return p.message ? 'asking OpenClaw: ' + String(p.message) : 'asking OpenClaw';
    case 'heartbeat_respond': return 'answering the heartbeat';
    case 'codex.list_mcp_resources': return 'listing MCP resources';
    case 'codex.list_mcp_resource_templates': return 'listing MCP resource templates';
    case 'memory_search': return 'searching memory: ' + String(p.query || '');
    case 'memory_get': return 'reading memory: ' + sanitizePath(String(p.path || 'memory'));
    case 'cron': return 'cron: ' + (p.action || 'action');
    case 'gateway': return 'gateway: ' + (p.action || 'action');
    case 'browser': return 'browser: ' + (p.action || 'action');
    case 'message': return 'sending message';
    case 'tts': return 'text-to-speech';
    case 'image': return 'analyzing image';
    case 'process': {
      const action = String(p.action || 'poll');
      if (action === 'poll' || action === 'log') return 'checking background task';
      if (action === 'list') return 'listing background tasks';
      if (action === 'kill') return 'stopping background task';
      if (action === 'write' || action === 'send-keys' || action === 'paste') return 'sending input to background task';
      return 'managing background task';
    }
    case 'session_status': return 'checking status';
    default: {
      // A tool this list does not know: add its main detail when it has one
      const detail = ['query', 'q', 'path', 'url', 'command', 'name']
        .map((key) => p[key])
        .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      return 'using ' + toolName + (detail ? ': ' + redactSecrets(detail.trim()) : '');
    }
  }
}
