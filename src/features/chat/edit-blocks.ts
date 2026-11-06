/** Extract Edit tool_use blocks from rawText and return diff-able data */
export interface EditBlock {
  filePath: string;
  oldText: string;
  newText: string;
}

/**
 * Codex-harness edits arrive as `apply_patch` calls, not `Edit` calls. Two shapes exist:
 * the app-server shape `{ changes: [{ path, kind: { type }, diff }] }` where `diff` is a unified
 * hunk, and the CLI shape `{ input: "*** Begin Patch ... *** End Patch" }`.
 */
const APPLY_PATCH_PATTERN = /\*\*tool:\*\*\s*`apply_patch`\s*\n```json\n([\s\S]*?)```/g;

interface PatchChange {
  path: string;
  kind: 'update' | 'add' | 'delete';
  diff: string;
}

function parseBeginPatch(text: string): PatchChange[] {
  const changes: PatchChange[] = [];
  let current: PatchChange | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (current) changes.push({ ...current, diff: lines.join('\n') });
    lines.length = 0;
  };
  for (const line of text.split('\n')) {
    const header = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (header) {
      flush();
      current = { path: header[2].trim(), kind: header[1].toLowerCase() as PatchChange['kind'], diff: '' };
      continue;
    }
    if (/^\*\*\* (Begin|End) Patch/.test(line) || /^\*\*\* Move to:/.test(line)) continue;
    if (current) lines.push(line);
  }
  flush();
  return changes;
}

function parseApplyPatch(json: string): PatchChange[] {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (Array.isArray(input.changes)) {
    const out: PatchChange[] = [];
    for (const raw of input.changes) {
      if (!raw || typeof raw !== 'object') continue;
      const change = raw as { path?: unknown; kind?: { type?: unknown } | string; diff?: unknown };
      const kind = typeof change.kind === 'string' ? change.kind : change.kind?.type;
      if (kind !== 'update' && kind !== 'add' && kind !== 'delete') continue;
      out.push({ path: String(change.path || ''), kind, diff: typeof change.diff === 'string' ? change.diff : '' });
    }
    return out;
  }
  const patchText = typeof input.input === 'string' ? input.input : typeof input.patch === 'string' ? input.patch : '';
  return patchText.includes('*** Begin Patch') ? parseBeginPatch(patchText) : [];
}

/** Split a unified hunk into the text before and after: context lines go to both sides. */
function splitHunk(diff: string): { oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('\\ No newline')) continue;
    if (line.startsWith('-')) oldLines.push(line.slice(1));
    else if (line.startsWith('+')) newLines.push(line.slice(1));
    else {
      const body = line.startsWith(' ') ? line.slice(1) : line;
      oldLines.push(body);
      newLines.push(body);
    }
  }
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

function applyPatchChanges(rawText: string): PatchChange[] {
  const changes: PatchChange[] = [];
  let match;
  const pattern = new RegExp(APPLY_PATCH_PATTERN.source, 'g');
  while ((match = pattern.exec(rawText)) !== null) {
    changes.push(...parseApplyPatch(match[1]));
  }
  return changes;
}

/** Parse edit blocks (search/replace pairs) from raw assistant text. */
export function extractEditBlocks(rawText: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  
  const toolPattern = /\*\*tool:\*\*\s*`(Edit|edit)`\s*\n```json\n([\s\S]*?)```/g;
  let match;

  const collectBlock = (input: Record<string, unknown>, fallbackPath = '') => {
    const filePath = String(input.file_path || input.path || fallbackPath || '');
    const oldStr = String(input.old_string || input.oldText || '');
    const newStr = String(input.new_string || input.newText || '');
    if (oldStr || newStr) {
      blocks.push({ filePath, oldText: oldStr, newText: newStr });
    }
  };
  
  while ((match = toolPattern.exec(rawText)) !== null) {
    try {
      const input = JSON.parse(match[2]) as Record<string, unknown>;
      const filePath = String(input.file_path || input.path || '');

      if (Array.isArray(input.edits)) {
        for (const edit of input.edits) {
          if (edit && typeof edit === 'object') {
            collectBlock(edit as Record<string, unknown>, filePath);
          }
        }
      }

      if (!Array.isArray(input.edits) || input.edits.length === 0) {
        collectBlock(input, filePath);
      }
    } catch { /* skip malformed JSON */ }
  }

  for (const change of applyPatchChanges(rawText)) {
    if (change.kind !== 'update' || !change.diff) continue;
    const { oldText, newText } = splitHunk(change.diff);
    if (oldText || newText) blocks.push({ filePath: change.path, oldText, newText });
  }

  return blocks;
}

/** Extract Write tool_use blocks: new file content */
export interface WriteBlock {
  filePath: string;
  content: string;
}

/** Parse write blocks (full file content) from raw assistant text. */
export function extractWriteBlocks(rawText: string): WriteBlock[] {
  const blocks: WriteBlock[] = [];
  
  const toolPattern = /\*\*tool:\*\*\s*`(Write|write)`\s*\n```json\n([\s\S]*?)```/g;
  let match;
  
  while ((match = toolPattern.exec(rawText)) !== null) {
    try {
      const input = JSON.parse(match[2]);
      const filePath = input.file_path || input.path || '';
      const content = input.content || '';
      if (content) {
        blocks.push({ filePath, content });
      }
    } catch { /* skip malformed JSON */ }
  }

  for (const change of applyPatchChanges(rawText)) {
    if (change.kind !== 'add' || !change.diff) continue;
    const content = change.diff
      .split('\n')
      .filter((line) => !line.startsWith('@@'))
      .map((line) => (line.startsWith('+') ? line.slice(1) : line))
      .join('\n');
    if (content) blocks.push({ filePath: change.path, content });
  }

  return blocks;
}
