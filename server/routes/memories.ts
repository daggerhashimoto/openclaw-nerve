/**
 * Memory API Routes
 *
 * GET  /api/memories     — Parsed memory data from MEMORY.md + daily files
 * POST /api/memories     — Store a new memory via gateway RPC
 * DELETE /api/memories   — Delete a memory via gateway RPC
 *
 * Response: Array of { type: "section"|"item"|"daily", text, date? }
 */

import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { invokeGatewayTool } from '../lib/gateway-client.js';
import { readText } from '../lib/files.js';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { broadcast } from './events.js';
import { withMutex } from '../lib/mutex.js';
import type { MemoryItem } from '../types.js';
import { resolveAgentWorkspace, type AgentWorkspace } from '../lib/agent-workspace.js';

const app = new Hono();

/* Gateway tool invocation via shared client */

/** Validation schema for creating a memory */
const createMemorySchema = z.object({
  text: z
    .string()
    .min(1, 'Text is required')
    .max(10000, 'Text too long (max 10000 chars)')
    .refine((s) => s.trim().length > 0, 'Text cannot be empty'),
  section: z.string().max(200, 'Section name too long').optional(),
  category: z.enum(['preference', 'fact', 'decision', 'entity', 'other']).optional(),
  importance: z.number().min(0).max(1).optional(),
  agentId: z.string().max(200).optional(),
});

/** Safe filename pattern: alphanumeric, hyphens, underscores, dots. No slashes, no `..` */
const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

/** Validation schema for deleting a memory */
const deleteMemorySchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query too long'),
  type: z.enum(['section', 'item', 'daily']).optional(),
  date: z.string().max(100).optional(),
  agentId: z.string().max(200).optional(),
});

/**
 * Clean up multiple consecutive blank lines in an array of lines
 */
function cleanBlankLines(lines: string[]): string[] {
  return lines.reduce((acc: string[], line) => {
    if (line.trim() === '' && acc.length > 0 && acc[acc.length - 1].trim() === '') {
      return acc;
    }
    acc.push(line);
    return acc;
  }, []);
}

/**
 * Delete a section (header + all content until next section) from file content
 */
function deleteSectionFromLines(lines: string[], sectionTitle: string): string[] | null {
  let sectionStart = -1;
  let sectionEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (sectionStart === -1) {
      // Looking for the section to delete
      if (trimmed.startsWith('## ') && trimmed.slice(3).trim() === sectionTitle) {
        sectionStart = i;
      }
    } else {
      // Found section, looking for next section header
      if (trimmed.startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }
  }

  if (sectionStart === -1) {
    return null; // Section not found
  }

  // Remove lines from sectionStart to sectionEnd (exclusive)
  return [...lines.slice(0, sectionStart), ...lines.slice(sectionEnd)];
}

/**
 * Delete a single line (bullet point) from file content
 */
function deleteItemFromLines(lines: string[], itemText: string): string[] | null {
  const originalLength = lines.length;

  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    // Match bullet points or numbered lists
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const clean = trimmed
        .replace(/^[-*]\s+|^\d+\.\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '');
      if (clean.trim() === itemText) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === originalLength) {
    return null; // Nothing was removed
  }

  return filtered;
}

interface DeleteOptions {
  text: string;
  type?: 'section' | 'item' | 'daily';
  date?: string; // For daily files: YYYY-MM-DD
}

function getMemoryFilePath(workspace: Pick<AgentWorkspace, 'memoryPath' | 'memoryDir'>, date?: string): string {
  if (date) {
    return path.join(workspace.memoryDir, `${date}.md`);
  }
  return workspace.memoryPath;
}

function getMutexKey(agentId: string): string {
  return `memory-file:${agentId}`;
}

function resolveWorkspaceOrResponse(c: Context, agentId?: string): AgentWorkspace | Response {
  try {
    return resolveAgentWorkspace(agentId);
  } catch {
    return c.json({ ok: false, error: 'Invalid agentId' }, 400);
  }
}

/**
 * Delete from MEMORY.md or daily files
 * - If type is 'section': delete the section header AND all items until the next section
 * - If type is 'item': delete just that one line from MEMORY.md
 * - If type is 'daily': delete the section from the daily file (memory/YYYY-MM-DD.md)
 */
async function deleteMemory(
  opts: DeleteOptions,
  workspace: Pick<AgentWorkspace, 'memoryPath' | 'memoryDir'>,
): Promise<{ deleted: boolean; file?: string }> {
  const { text, type, date } = opts;

  // Validate filename to prevent path traversal
  if (date && (!SAFE_FILENAME.test(date) || date.includes('..'))) {
    return { deleted: false };
  }

  try {
    const filePath = getMemoryFilePath(workspace, type === 'daily' ? date : undefined);
    const content = await readText(filePath);
    if (!content) {
      return { deleted: false };
    }

    const lines = content.split('\n');
    let result: string[] | null = null;

    if (type === 'section' || type === 'daily') {
      // Delete entire section (header + content until next section)
      result = deleteSectionFromLines(lines, text);
    } else {
      // Delete single item (bullet point)
      result = deleteItemFromLines(lines, text);
    }

    if (!result) {
      return { deleted: false };
    }

    // Clean up and save
    const cleaned = cleanBlankLines(result);
    await fs.writeFile(filePath, cleaned.join('\n'), 'utf-8');

    return { deleted: true, file: path.basename(filePath) };
  } catch (err) {
    console.error('[memories] Failed to delete:', (err as Error).message);
    return { deleted: false };
  }
}

// invokeGatewayTool imported from shared module

/**
 * Append a bullet point to MEMORY.md under the given section heading.
 * If the section doesn't exist, create it at the end of the file.
 */
async function appendToMemoryFile(text: string, section: string, filePath: string): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet — start fresh
    content = '# MEMORY.md\n';
  }

  const lines = content.split('\n');
  const sectionHeader = `## ${section}`;

  // Find the section
  let sectionStart = -1;
  let sectionEnd = lines.length; // default: end of file

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (sectionStart === -1) {
      if (trimmed.toLowerCase() === sectionHeader.toLowerCase()) {
        sectionStart = i;
      }
    } else {
      // Found section, look for next section header
      if (trimmed.startsWith('## ')) {
        sectionEnd = i;
        break;
      }
    }
  }

  const bulletLine = `- ${text}`;

  if (sectionStart === -1) {
    // Section doesn't exist — append new section at end of file
    // Ensure trailing newline before new section
    const trimmedEnd = content.trimEnd();
    const newContent = `${trimmedEnd}\n\n${sectionHeader}\n${bulletLine}\n`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, newContent, 'utf-8');
  } else {
    // Section exists — find the last non-blank line within the section to append after
    let insertAt = sectionEnd;
    // Walk backwards from sectionEnd to find last content line in section
    for (let i = sectionEnd - 1; i > sectionStart; i--) {
      if (lines[i].trim() !== '') {
        insertAt = i + 1;
        break;
      }
    }

    // Insert the bullet line
    lines.splice(insertAt, 0, bulletLine);
    const cleaned = cleanBlankLines(lines);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, cleaned.join('\n'), 'utf-8');
  }
}

app.get('/api/memories', rateLimitGeneral, async (c) => {
  const workspace = resolveWorkspaceOrResponse(c, c.req.query('agentId'));
  if (workspace instanceof Response) return workspace;

  const memories: MemoryItem[] = [];

  // Parse MEMORY.md — sections and bullet points
  const content = await readText(workspace.memoryPath);
  if (content) {
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) {
        memories.push({ type: 'section', text: trimmed.slice(3).trim() });
      } else if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        const clean = trimmed
          .replace(/^[-*]\s+|^\d+\.\s+/, '')
          .replace(/\*\*/g, '')
          .replace(/`/g, '');
        if (clean.length > 0) {
          memories.push({ type: 'item', text: clean });
        }
      }
    }
  }

  // Parse recent daily files — section headers only
  try {
    const files = (await fs.readdir(workspace.memoryDir))
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 7);

    for (const f of files) {
      const dailyContent = await readText(path.join(workspace.memoryDir, f));
      for (const line of dailyContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ')) {
          memories.push({
            type: 'daily',
            date: f.replace('.md', ''),
            text: trimmed.slice(3).trim(),
          });
        }
      }
    }
  } catch {
    // Memory dir may not exist — that's fine
  }

  return c.json(memories);
});

/**
 * GET /api/memories/section — Get raw markdown content of a section
 *
 * Query params:
 *   - title: Section title (required)
 *   - date: For daily files, the date (YYYY-MM-DD). Omit for MEMORY.md
 *
 * Returns: { ok: true, content: string } or { ok: false, error: string }
 */
app.get('/api/memories/section', rateLimitGeneral, async (c) => {
  const title = c.req.query('title');
  const date = c.req.query('date');

  if (!title) {
    return c.json({ ok: false, error: 'Missing title parameter' }, 400);
  }

  // Validate filename to prevent path traversal
  if (date && (!SAFE_FILENAME.test(date) || date.includes('..'))) {
    return c.json({ ok: false, error: 'Invalid filename' }, 400);
  }

  const workspace = resolveWorkspaceOrResponse(c, c.req.query('agentId'));
  if (workspace instanceof Response) return workspace;

  try {
    const filePath = getMemoryFilePath(workspace, date);
    const content = await readText(filePath);
    if (!content) {
      return c.json({ ok: false, error: 'File not found' }, 404);
    }

    const lines = content.split('\n');
    let sectionStart = -1;
    let sectionEnd = lines.length;

    // Find the section
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (sectionStart === -1) {
        if (trimmed.startsWith('## ') && trimmed.slice(3).trim() === title) {
          sectionStart = i;
        }
      } else {
        if (trimmed.startsWith('## ')) {
          sectionEnd = i;
          break;
        }
      }
    }

    if (sectionStart === -1) {
      return c.json({ ok: false, error: 'Section not found' }, 404);
    }

    // Extract section content (excluding the header itself)
    const sectionLines = lines.slice(sectionStart + 1, sectionEnd);
    const sectionContent = sectionLines.join('\n').trim();

    return c.json({ ok: true, content: sectionContent });
  } catch (err) {
    console.error('[memories] GET section error:', (err as Error).message);
    return c.json({ ok: false, error: 'Failed to read memory section' }, 500);
  }
});

/**
 * POST /api/memories — Store a new memory
 *
 * Body: { text: string, section?: string, category?: string, importance?: number }
 *
 * Writes the memory as a bullet point to MEMORY.md under the given section,
 * and also stores it in the gateway's LanceDB for vector search.
 */
app.post(
  '/api/memories',
  rateLimitGeneral,
  zValidator('json', createMemorySchema, (result, c) => {
    if (!result.success) {
      const msg = result.error.issues[0]?.message || 'Invalid request';
      return c.json({ ok: false, error: msg }, 400);
    }
  }),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const workspace = resolveWorkspaceOrResponse(c, body.agentId ?? c.req.query('agentId'));
      if (workspace instanceof Response) return workspace;

      const trimmedText = body.text.trim();
      const safeSection = (body.section ?? '').replace(/[\r\n]/g, ' ').trim();
      const section = safeSection || 'General';

      // 1. Write to MEMORY.md (primary display source)
      await withMutex(getMutexKey(workspace.agentId), () => appendToMemoryFile(trimmedText, section, workspace.memoryPath));

      // 2. Also store in gateway LanceDB (for vector search) — best effort
      try {
        await invokeGatewayTool('memory_store', {
          text: trimmedText,
          category: body.category || 'other',
          importance: body.importance ?? 0.7,
        });
      } catch (err) {
        // Gateway store is best-effort; file write is what matters
        console.warn('[memories] Gateway memory_store failed (non-fatal):', (err as Error).message);
      }

      // Broadcast memory change to all SSE clients
      broadcast('memory.changed', { source: 'api', action: 'create', section, agentId: workspace.agentId });

      return c.json({ ok: true, result: { written: true, section } });
    } catch (err) {
      console.error('[memories] POST error:', (err as Error).message);
      return c.json({ ok: false, error: 'Failed to store memory' }, 500);
    }
  },
);

/**
 * PUT /api/memories/section — Update a section's content
 *
 * Body: { title: string, content: string, date?: string }
 */
const updateSectionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  content: z.string().max(50000, 'Content too long'),
  date: z.string().max(100).optional(),
  agentId: z.string().max(200).optional(),
});

app.put(
  '/api/memories/section',
  rateLimitGeneral,
  zValidator('json', updateSectionSchema, (result, c) => {
    if (!result.success) {
      const msg = result.error.issues[0]?.message || 'Invalid request';
      return c.json({ ok: false, error: msg }, 400);
    }
  }),
  async (c) => {
    try {
      const { title, content, date, agentId } = c.req.valid('json');

      // Validate filename to prevent path traversal
      if (date && (!SAFE_FILENAME.test(date) || date.includes('..'))) {
        return c.json({ ok: false, error: 'Invalid filename' }, 400);
      }

      const workspace = resolveWorkspaceOrResponse(c, agentId ?? c.req.query('agentId'));
      if (workspace instanceof Response) return workspace;
      const filePath = getMemoryFilePath(workspace, date);

      const result = await withMutex(getMutexKey(workspace.agentId), async () => {
        const fileContent = await readText(filePath);
        if (!fileContent) {
          return { ok: false as const, error: 'File not found', status: 404 as const };
        }

        const lines = fileContent.split('\n');
        let sectionStart = -1;
        let sectionEnd = lines.length;

        // Find the section
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (sectionStart === -1) {
            if (trimmed.startsWith('## ') && trimmed.slice(3).trim() === title) {
              sectionStart = i;
            }
          } else {
            if (trimmed.startsWith('## ')) {
              sectionEnd = i;
              break;
            }
          }
        }

        if (sectionStart === -1) {
          return { ok: false as const, error: 'Section not found', status: 404 as const };
        }

        // Replace the section content (keep the header, replace everything until next section)
        const newLines = [
          ...lines.slice(0, sectionStart + 1), // Everything before section + section header
          content, // New content
          '', // Blank line before next section
          ...lines.slice(sectionEnd), // Everything from next section onwards
        ];

        // Clean up multiple consecutive blank lines
        const cleaned = cleanBlankLines(newLines);
        await fs.writeFile(filePath, cleaned.join('\n'), 'utf-8');
        return { ok: true as const };
      });

      if (!result.ok) {
        return c.json({ ok: false, error: result.error }, result.status);
      }

      // Broadcast memory change to all SSE clients
      broadcast('memory.changed', {
        source: 'api',
        action: 'update',
        file: path.basename(filePath),
        section: title,
        agentId: workspace.agentId,
      });

      return c.json({
        ok: true,
        result: {
          updated: true,
          file: path.basename(filePath),
          section: title,
        }
      });
    } catch (err) {
      console.error('[memories] PUT section error:', (err as Error).message);
      return c.json({ ok: false, error: 'Failed to update memory section' }, 500);
    }
  },
);

/**
 * DELETE /api/memories — Delete a memory from MEMORY.md
 *
 * Body: { query: string, type?: 'section' | 'item' | 'daily' }
 */
app.delete(
  '/api/memories',
  rateLimitGeneral,
  zValidator('json', deleteMemorySchema, (result, c) => {
    if (!result.success) {
      const msg = result.error.issues[0]?.message || 'Invalid request';
      return c.json({ ok: false, error: msg }, 400);
    }
  }),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const workspace = resolveWorkspaceOrResponse(c, body.agentId ?? c.req.query('agentId'));
      if (workspace instanceof Response) return workspace;

      const result = await withMutex(getMutexKey(workspace.agentId), () => deleteMemory({
        text: body.query,
        type: body.type,
        date: body.date,
      }, workspace));

      if (result.deleted) {
        // Broadcast memory change to all SSE clients
        broadcast('memory.changed', {
          source: 'api',
          action: 'delete',
          file: result.file,
          agentId: workspace.agentId,
        });

        return c.json({
          ok: true,
          result: {
            deleted: 1,
            source: 'file',
            file: result.file,
            type: body.type || 'item',
          }
        });
      } else {
        const file = body.type === 'daily' ? `memory/${body.date}.md` : 'MEMORY.md';
        return c.json({ ok: false, error: `Memory not found in ${file}` }, 404);
      }
    } catch (err) {
      console.error('[memories] DELETE error:', (err as Error).message);
      return c.json({ ok: false, error: 'Failed to delete memory' }, 500);
    }
  },
);

export default app;
