/**
 * Resolve the target version for an update.
 *
 * Priority when no explicit version is provided:
 *   1) Latest published GitHub release
 *   2) Latest semver tag (fallback)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listAvailableSemverVersions,
  normalizeSemverTag,
  resolveLatestVersion,
} from '../release-source.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type { ResolvedVersion } from './types.js';

/**
 * Resolve the target update version.
 * If `explicitVersion` is given, validates that the corresponding semver tag exists.
 * Otherwise, resolves latest published release and falls back to latest semver tag.
 */
export async function resolveVersion(cwd: string, explicitVersion?: string): Promise<ResolvedVersion> {
  const pkgPath = join(cwd, 'package.json');
  let current: string;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    current = pkg.version;
  } catch {
    throw new UpdateError(
      `Cannot read ${pkgPath}`,
      'resolve',
      EXIT_CODES.VERSION_RESOLUTION,
    );
  }

  let tag: string;
  let version: string;
  let source: ResolvedVersion['source'];

  if (explicitVersion) {
    const normalized = normalizeSemverTag(explicitVersion);
    if (!normalized) {
      throw new UpdateError(
        `Invalid version ${explicitVersion} (expected vX.Y.Z)` ,
        'resolve',
        EXIT_CODES.VERSION_RESOLUTION,
      );
    }

    const available = listAvailableSemverVersions(cwd);
    if (!available.includes(normalized)) {
      throw new UpdateError(
        `Tag v${normalized} not found (available: ${available.map(v => `v${v}`).join(', ') || 'none'})`,
        'resolve',
        EXIT_CODES.VERSION_RESOLUTION,
      );
    }

    version = normalized;
    tag = `v${version}`;
    source = 'explicit';
  } else {
    const latest = await resolveLatestVersion(cwd);
    if (!latest) {
      throw new UpdateError(
        'No published release or semver tags found',
        'resolve',
        EXIT_CODES.VERSION_RESOLUTION,
      );
    }

    version = latest.version;
    tag = `v${version}`;
    source = latest.source;
  }

  return {
    tag,
    version,
    current,
    isUpToDate: version === current,
    source,
  };
}
