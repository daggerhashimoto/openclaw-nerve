/**
 * GET /api/version/check — Check if a newer version is available.
 *
 * Uses latest published GitHub release first, then latest semver tag fallback.
 */

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { compareSemver, resolveLatestVersion } from '../lib/release-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  version: string;
};

interface VersionCache {
  latest: string;
  source: 'release' | 'tag';
  checkedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache: VersionCache | null = null;

const app = new Hono();

app.get('/api/version/check', rateLimitGeneral, async (c) => {
  const now = Date.now();
  const cwd = resolve(__dirname, '../..');

  // Serve from cache if fresh.
  if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
    return c.json({
      current: pkg.version,
      latest: cache.latest,
      source: cache.source,
      updateAvailable: compareSemver(cache.latest, pkg.version) > 0,
    });
  }

  const latest = await resolveLatestVersion(cwd);
  if (!latest) {
    return c.json({
      current: pkg.version,
      latest: null,
      source: null,
      updateAvailable: false,
      error: 'Could not fetch release or semver tags',
    });
  }

  cache = {
    latest: latest.version,
    source: latest.source,
    checkedAt: now,
  };

  return c.json({
    current: pkg.version,
    latest: latest.version,
    source: latest.source,
    updateAvailable: compareSemver(latest.version, pkg.version) > 0,
  });
});

export default app;
