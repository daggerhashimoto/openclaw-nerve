/**
 * Parse kanban proposal markers from assistant message text (server-side copy).
 *
 * Markers follow the protocol:
 *   [kanban:create]{"title":"...","priority":"high"}[/kanban:create]
 *   [kanban:update]{"id":"abc","status":"done"}[/kanban:update]
 *
 * Safety limits:
 *   - Max 5 markers per message
 *   - Max 2KB per JSON payload
 *
 * Copied from src/features/kanban/lib/parseMarkers.ts — keep in sync.
 * @module
 */

export type MarkerType = 'create' | 'update';

export interface ParsedMarker {
  type: MarkerType;
  payload: Record<string, unknown>;
  raw: string;
}

const MAX_MARKERS = 5;
const MAX_PAYLOAD_BYTES = 2048;

const MARKER_RE = /\[kanban:(create|update)\]([\s\S]*?)\[\/kanban:\1\]/g;

/**
 * Parse kanban markers from assistant message text.
 * Returns an array of validated markers, or empty array if none found.
 */
export function parseKanbanMarkers(text: string): ParsedMarker[] {
  if (!text) return [];

  const results: ParsedMarker[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  MARKER_RE.lastIndex = 0;

  while ((match = MARKER_RE.exec(text)) !== null) {
    if (results.length >= MAX_MARKERS) break;

    const type = match[1] as MarkerType;
    const jsonStr = match[2].trim();
    const raw = match[0];

    // Enforce payload size limit
    if (new TextEncoder().encode(jsonStr).length > MAX_PAYLOAD_BYTES) {
      continue;
    }

    // Strict JSON parse
    let payload: unknown;
    try {
      payload = JSON.parse(jsonStr);
    } catch {
      continue; // malformed JSON — skip
    }

    // Must be a plain object
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      continue;
    }

    const obj = payload as Record<string, unknown>;

    // Validate required fields per type
    if (type === 'create') {
      if (typeof obj.title !== 'string' || obj.title.trim().length === 0) {
        continue;
      }
    } else if (type === 'update') {
      if (typeof obj.id !== 'string' || obj.id.trim().length === 0) {
        continue;
      }
    }

    results.push({ type, payload: obj, raw });
  }

  return results;
}

/**
 * Strip kanban markers from text so stored results are clean.
 * Removes all valid and invalid marker patterns (anything matching the marker tags).
 */
export function stripKanbanMarkers(text: string): string {
  if (!text) return text;
  MARKER_RE.lastIndex = 0;
  return text.replace(MARKER_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}
