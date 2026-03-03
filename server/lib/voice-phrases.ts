/**
 * Voice phrase configuration — per-language stop/cancel/wake phrases.
 *
 * Primary runtime config file: ~/.nerve/voice-phrases.json
 * Legacy fallback (read-only): <PROJECT_ROOT>/voice-phrases.json
 *
 * Format (v2 — per-language):
 * {
 *   "en": { "stopPhrases": [...], "cancelPhrases": [...] },
 *   "fr": { "stopPhrases": [...], "cancelPhrases": [...] }
 * }
 *
 * Legacy flat format (v1):
 * { "stopPhrases": [...], "cancelPhrases": [...] }
 *   → interpreted as the "en" entry.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE_PHRASES, type LanguageVoicePhrases } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LEGACY_CONFIG_PATH = path.join(PROJECT_ROOT, 'voice-phrases.json');
const CONFIG_PATH = process.env.NERVE_VOICE_PHRASES_PATH || path.join(process.env.HOME || os.homedir(), '.nerve', 'voice-phrases.json');

type PhrasesStore = Record<string, LanguageVoicePhrases>;

let cached: PhrasesStore | null = null;
let cachedMtime = 0;
let cachedPath = '';

/** Check if object is legacy v1 flat format (has stopPhrases at top level). */
function isLegacyFormat(raw: unknown): raw is LanguageVoicePhrases {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'stopPhrases' in raw &&
    Array.isArray((raw as Record<string, unknown>).stopPhrases)
  );
}

function resolveReadPath(): string | null {
  if (fs.existsSync(CONFIG_PATH)) return CONFIG_PATH;
  if (fs.existsSync(LEGACY_CONFIG_PATH)) return LEGACY_CONFIG_PATH;
  return null;
}

function parseStore(raw: unknown): PhrasesStore {
  // Legacy flat format (v1) — interpret as English-only.
  if (isLegacyFormat(raw)) {
    return {
      en: {
        stopPhrases: raw.stopPhrases,
        cancelPhrases: Array.isArray(raw.cancelPhrases) ? raw.cancelPhrases : DEFAULT_VOICE_PHRASES.en.cancelPhrases,
      },
    };
  }

  // v2 format — validate entries
  if (!raw || typeof raw !== 'object') return {};

  const store: PhrasesStore = {};
  for (const [lang, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== 'object' || val === null) continue;

    const v = val as Record<string, unknown>;
    const entry: LanguageVoicePhrases = {
      stopPhrases: Array.isArray(v.stopPhrases) ? v.stopPhrases as string[] : [],
      cancelPhrases: Array.isArray(v.cancelPhrases) ? v.cancelPhrases as string[] : [],
    };

    if (Array.isArray(v.wakePhrases) && v.wakePhrases.length > 0) {
      const primaryWake = (v.wakePhrases as string[])
        .map((phrase) => phrase.trim())
        .find((phrase) => phrase.length > 0);
      if (primaryWake) {
        entry.wakePhrases = [primaryWake];
      }
    }

    store[lang] = entry;
  }

  return store;
}

/** Read the full per-language phrases store. */
function readStore(): PhrasesStore {
  try {
    const readPath = resolveReadPath();
    if (!readPath) return {};

    const stat = fs.statSync(readPath);
    if (cached && readPath === cachedPath && stat.mtimeMs === cachedMtime) return cached;

    const raw = JSON.parse(fs.readFileSync(readPath, 'utf-8'));
    const store = parseStore(raw);

    cached = store;
    cachedPath = readPath;
    cachedMtime = stat.mtimeMs;
    return store;
  } catch {
    // File missing or invalid — return empty (defaults come from constants)
    return {};
  }
}

/** Write the full store to disk and refresh cache. */
function writeStore(store: PhrasesStore): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  cached = store;
  cachedPath = CONFIG_PATH;
  cachedMtime = fs.statSync(CONFIG_PATH).mtimeMs;
}

/**
 * Get voice phrases for a specific language.
 * Returns only that language's phrase set (custom > defaults), without English merge.
 * Falls back to English only if the requested language has no configured/default set.
 */
export function getVoicePhrases(lang?: string): LanguageVoicePhrases {
  const store = readStore();
  const effectiveLang = (lang || 'en').toLowerCase();

  const langPhrases = store[effectiveLang] || DEFAULT_VOICE_PHRASES[effectiveLang];
  if (langPhrases) {
    return langPhrases;
  }

  return store['en'] || DEFAULT_VOICE_PHRASES.en;
}

/**
 * Get phrases for a specific language only (no English merge).
 * Used by the settings UI to show what's configured per-language.
 */
export function getLanguagePhrases(lang: string): LanguageVoicePhrases | null {
  const store = readStore();
  return store[lang] || null;
}

/**
 * Check if custom phrases have been configured for a language.
 */
export function hasCustomPhrases(lang: string): boolean {
  const store = readStore();
  return lang in store;
}

/**
 * Save custom phrases for a specific language.
 */
export function setLanguagePhrases(lang: string, phrases: LanguageVoicePhrases): void {
  const store = readStore();
  const entry: LanguageVoicePhrases = {
    stopPhrases: phrases.stopPhrases.filter(p => p.trim().length > 0),
    cancelPhrases: phrases.cancelPhrases.filter(p => p.trim().length > 0),
  };
  if (phrases.wakePhrases?.length) {
    const primaryWake = phrases.wakePhrases
      .map((phrase) => phrase.trim())
      .find((phrase) => phrase.length > 0);
    if (primaryWake) {
      entry.wakePhrases = [primaryWake];
    }
  }
  store[lang] = entry;
  writeStore(store);
}

/**
 * Get the full store (for admin/debug).
 */
export function getAllPhrases(): PhrasesStore {
  return readStore();
}
