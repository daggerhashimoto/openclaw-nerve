/**
 * Shared release/version resolution helpers.
 *
 * Source priority:
 *  1) Latest published GitHub release
 *  2) Latest semver tag (fallback)
 */

import { execSync } from 'node:child_process';
import https from 'node:https';

export type LatestVersionSource = 'release' | 'tag';

interface GitHubRepo {
  owner: string;
  repo: string;
}

const SEMVER_TAG_REGEX = /^v?(\d+\.\d+\.\d+)$/;
const RELEASE_REQUEST_TIMEOUT_MS = 10_000;

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function normalizeSemverTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const match = SEMVER_TAG_REGEX.exec(tag.trim());
  return match ? match[1] : null;
}

function parseSemverTags(output: string): string[] {
  const versions: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^(?:refs\/tags\/)?v?(\d+\.\d+\.\d+)$/.exec(line.trim());
    if (match && !versions.includes(match[1])) {
      versions.push(match[1]);
    }
  }
  return versions.sort(compareSemver);
}

function getOriginRemoteUrl(cwd: string): string | null {
  try {
    return execSync('git remote get-url origin', { cwd, stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function parseGitHubRepo(remoteUrl: string): GitHubRepo | null {
  const patterns = [
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(remoteUrl);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

function fetchSemverTagsFromCommand(cwd: string, command: string): string[] {
  try {
    const output = execSync(command, { cwd, stdio: 'pipe' }).toString();
    return parseSemverTags(output);
  } catch {
    return [];
  }
}

export function listAvailableSemverVersions(cwd: string): string[] {
  const remote = fetchSemverTagsFromCommand(cwd, 'git ls-remote --tags origin');
  if (remote.length > 0) return remote;
  return fetchSemverTagsFromCommand(cwd, 'git tag -l');
}

export function latestSemverTagVersion(cwd: string): string | null {
  const versions = listAvailableSemverVersions(cwd);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

function requestJson(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          body += chunk;
        });

        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
    });
    req.end();
  });
}

export async function latestReleaseVersion(cwd: string): Promise<string | null> {
  const remoteUrl = getOriginRemoteUrl(cwd);
  if (!remoteUrl) return null;

  const repo = parseGitHubRepo(remoteUrl);
  if (!repo) return null;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nerve-updater',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const payload = await requestJson(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
      headers,
      RELEASE_REQUEST_TIMEOUT_MS,
    );

    const tagName =
      payload && typeof payload === 'object' && 'tag_name' in payload && typeof payload.tag_name === 'string'
        ? payload.tag_name
        : null;

    return normalizeSemverTag(tagName);
  } catch {
    return null;
  }
}

export async function resolveLatestVersion(
  cwd: string,
): Promise<{ version: string; source: LatestVersionSource } | null> {
  const release = await latestReleaseVersion(cwd);
  if (release) {
    return { version: release, source: 'release' };
  }

  const fallbackTag = latestSemverTagVersion(cwd);
  if (fallbackTag) {
    return { version: fallbackTag, source: 'tag' };
  }

  return null;
}
