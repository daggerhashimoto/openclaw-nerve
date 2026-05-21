/**
 * Shared file utilities for the file browser.
 *
 * Path validation, exclusion lists, binary detection, and workspace
 * path resolution. Used by both the file-browser API routes and
 * the extended file watcher.
 * @module
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config.js';

// ── Exclusion rules ──────────────────────────────────────────────────
// When FILE_BROWSER_ROOT is set, disable all exclusions to show complete directory structure
// When using default workspace, apply standard exclusions for safety and cleanliness

const DEFAULT_EXCLUDED_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', 'server-dist', 'certs',
  '.env', 'agent-log.json',
]);

const DEFAULT_EXCLUDED_PATTERNS = [
  /^\.env(\.|$)/,   // .env, .env.local, .env.production, etc.
  /\.log$/,
];

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot',
  '.sqlite', '.db',
]);

const EMPTY_EXCLUDED_NAMES = new Set<string>();
const EMPTY_EXCLUDED_PATTERNS: RegExp[] = [];

export interface ResolveWorkspacePathOptions {
  allowNonExistent?: boolean;
}

/** Get exclusion names based on current config state */
function getExcludedNames(): Set<string> {
  const customRoot = (config.fileBrowserRoot || '').trim();
  return customRoot ? EMPTY_EXCLUDED_NAMES : DEFAULT_EXCLUDED_NAMES;
}

/** Get exclusion patterns based on current config state */
function getExcludedPatterns(): RegExp[] {
  const customRoot = (config.fileBrowserRoot || '').trim();
  return customRoot ? EMPTY_EXCLUDED_PATTERNS : DEFAULT_EXCLUDED_PATTERNS;
}

/** Check if a file/directory name should be excluded from the tree. */
export function isExcluded(name: string): boolean {
  const excludedNames = getExcludedNames();
  const excludedPatterns = getExcludedPatterns();

  if (excludedNames.has(name)) return true;
  return excludedPatterns.some((pattern) => pattern.test(name));
}

/** Check if a file extension indicates binary content. */
export function isBinary(name: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(name).toLowerCase());
}

// ── Workspace root ───────────────────────────────────────────────────

/** Resolve the workspace root directory. Uses the explicit root if provided, otherwise FILE_BROWSER_ROOT or parent of MEMORY.md. */
export function getWorkspaceRoot(workspaceRoot?: string): string {
  if (workspaceRoot && workspaceRoot.trim()) {
    return path.resolve(workspaceRoot);
  }

  const customRoot = (config.fileBrowserRoot || '').trim();
  return customRoot ? path.resolve(customRoot) : path.dirname(config.memoryPath);
}

// ── Path validation ──────────────────────────────────────────────────

/** Max file size for reading/writing (1 MB). */
export const MAX_FILE_SIZE = 1_048_576;

/**
 * Validate and resolve a relative path to an absolute path within an explicit workspace root.
 */
export async function resolveWorkspacePathForRoot(
  workspaceRoot: string,
  relativePath: string,
  options?: ResolveWorkspacePathOptions,
): Promise<string | null> {
  const root = getWorkspaceRoot(workspaceRoot);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  const realRoot = await fs.realpath(root).catch(() => root);
  const realRootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  const isWithinLexicalRoot = (candidate: string) => candidate === root || candidate.startsWith(rootPrefix);
  const isWithinRealRoot = (candidate: string) => candidate === realRoot || candidate.startsWith(realRootPrefix);

  // Block obvious traversal attempts
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null;
  }

  // Check each path segment for exclusions
  const segments = normalized.split(path.sep);
  if (segments.some((segment) => segment && isExcluded(segment))) {
    return null;
  }

  const resolved = path.resolve(root, normalized);

  // Must be within workspace root
  if (!isWithinLexicalRoot(resolved)) {
    return null;
  }

  // Resolve symlinks and re-check
  try {
    const real = await fs.realpath(resolved);
    if (!isWithinRealRoot(real)) {
      return null;
    }
    return resolved;
  } catch {
    // File doesn't exist
    if (!options?.allowNonExistent) return null;

    // Walk up until we find an existing ancestor. This allows creating the
    // first file in a fresh workspace, or nested paths whose parents will be
    // created later via mkdir({ recursive: true }).
    let current = path.dirname(resolved);
    while (current !== root) {
      try {
        const realCurrent = await fs.realpath(current);
        if (!isWithinRealRoot(realCurrent)) {
          return null;
        }
        return resolved;
      } catch {
        const next = path.dirname(current);
        if (next === current) {
          return null;
        }
        current = next;
      }
    }

    if (!isWithinRealRoot(realRoot)) {
      return null;
    }

    return resolved;
  }
}

/**
 * Validate and resolve a relative path to an absolute path within the default workspace.
 */
export async function resolveWorkspacePath(
  relativePath: string,
  options?: ResolveWorkspacePathOptions,
): Promise<string | null> {
  return resolveWorkspacePathForRoot(getWorkspaceRoot(), relativePath, options);
}
