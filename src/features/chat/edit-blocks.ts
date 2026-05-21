/** Extract Edit tool_use blocks from rawText and return diff-able data */
export interface EditBlock {
  filePath: string;
  oldText: string;
  newText: string;
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
  
  return blocks;
}

/** Extract Write tool_use blocks — new file content */
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
  
  return blocks;
}
