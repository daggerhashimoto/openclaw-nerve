/**
 * GET /api/version/check — Check if a newer version is available.
 *
 * Uses latest published GitHub release first, then latest semver tag fallback.
 */

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rateLimitGeneral } from '../middleware/rate-limit.js';
import { compareSemver, resolveLatestVersion } from '../lib/release-source.js';
import { resolveProjectRoot } from '../lib/project-root.js';

const projectDir = resolveProjectRoot(import.meta.url);
const pkg = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf-8')) as {
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

  // Serve from cache if fresh.
  if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
    return c.json({
      current: pkg.version,
      latest: cache.latest,
      source: cache.source,
      updateAvailable: compareSemver(cache.latest, pkg.version) > 0,
      projectDir,
    });
  }

  const latest = await resolveLatestVersion(projectDir);
  if (!latest) {
    return c.json({
      current: pkg.version,
      latest: null,
      source: null,
      updateAvailable: false,
      error: 'Could not fetch release or semver tags',
      projectDir,
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
    projectDir,
  });
});

export default app;
