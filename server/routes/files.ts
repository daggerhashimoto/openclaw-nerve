/**
 * GET /api/files?path=<encoded-path> — serve local image files.
 *
 * Security:
 *  - Image MIME types only (png, jpg, gif, webp, svg, avif)
 *  - Directory traversal blocked (resolve + prefix check)
 *  - Restricted to allowed directory prefixes
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../lib/config.js';

const app = new Hono();

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** Directories we allow serving files from. */
async function allowedPrefixes(): Promise<string[]> {
  const home = os.homedir();
  const prefixes = [
    '/tmp',
    os.tmpdir(),
    path.join(home, '.openclaw'),
    config.memoryDir,
  ].filter(Boolean).map((prefix) => path.resolve(prefix));

  const canonicalPrefixes = await Promise.all(
    prefixes.map(async (prefix) => fs.promises.realpath(prefix).catch(() => prefix)),
  );

  return Array.from(new Set([...prefixes, ...canonicalPrefixes]));
}

function isPathWithinPrefix(candidate: string, prefix: string): boolean {
  const relative = path.relative(prefix, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

app.get('/api/files', async (c) => {
  const rawPath = c.req.query('path');
  if (!rawPath) return c.text('Missing path parameter', 400);

  // Resolve to absolute, blocking traversal
  const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));
  const ext = path.extname(resolved).toLowerCase();

  // MIME check — images only
  const mime = MIME_MAP[ext];
  if (!mime) return c.text('Not an allowed file type', 403);

  // Directory prefix check
  const prefixes = await allowedPrefixes();
  const allowed = prefixes.some((prefix) => isPathWithinPrefix(resolved, prefix));
  if (!allowed) return c.text('Access denied', 403);

  // Resolve symlinks and re-check prefix to prevent symlink traversal
  let realPath: string;
  try {
    realPath = await fs.promises.realpath(resolved);
  } catch {
    return c.text('Not found', 404);
  }
  const realAllowed = prefixes.some((prefix) => isPathWithinPrefix(realPath, prefix));
  if (!realAllowed) return c.text('Access denied', 403);

  try {
    const data = await fs.promises.readFile(realPath);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(data.length),
        // Force download for SVGs to prevent stored XSS via embedded <script> tags
        ...(ext === '.svg' ? { 'Content-Disposition': 'attachment' } : {}),
      },
    });
  } catch {
    return c.text('Failed to read file', 500);
  }
});

export default app;
