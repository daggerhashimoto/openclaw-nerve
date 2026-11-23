import { beforeEach, describe, expect, it, vi } from 'vitest';

const { outputs, execSync } = vi.hoisted(() => {
  const outputs = new Map<string, string | Error>();
  const execSync = (command: string) => {
    const out = outputs.get(command);
    if (out === undefined || out instanceof Error) throw out ?? new Error(`unexpected command: ${command}`);
    return Buffer.from(out);
  };
  return { outputs, execSync };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execSync, default: { ...actual, execSync } };
});

const { listAvailableSemverVersions, latestSemverTagVersion } = await import('./release-source.js');

const LS_REMOTE = [
  '28281095b47da2b7c131e213b356e64203af7e1a\trefs/tags/archive/next-2026-06',
  '78537087d24c73122f0c661edcd7b014ef1bb35e\trefs/tags/v1.3.0',
  '9d1c0a3f5e2b4c6d8e0f1a2b3c4d5e6f7a8b9c0d\trefs/tags/v1.5.4',
  '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\trefs/tags/v1.5.4^{}',
  'aabbccddeeff00112233445566778899aabbccdd\trefs/tags/v1.10.0',
  'bbccddeeff00112233445566778899aabbccddee\trefs/tags/v1.6.0-beta.1',
  'ccddeeff00112233445566778899aabbccddeeff\trefs/tags/1.4.2',
].join('\n') + '\n';

describe('listAvailableSemverVersions', () => {
  beforeEach(() => {
    outputs.clear();
  });

  it('reads the semver tags from git ls-remote, which prints a hash before each ref', () => {
    outputs.set('git ls-remote --tags origin', LS_REMOTE);

    expect(listAvailableSemverVersions('/repo')).toEqual(['1.3.0', '1.4.2', '1.5.4', '1.10.0']);
  });

  it('skips peeled ^{} refs, prereleases and non-semver tags', () => {
    outputs.set('git ls-remote --tags origin', LS_REMOTE);

    const versions = listAvailableSemverVersions('/repo');

    expect(versions.filter((v) => v === '1.5.4')).toHaveLength(1);
    expect(versions).not.toContain('1.6.0-beta.1');
    expect(versions.some((v) => v.includes('next'))).toBe(false);
  });

  it('prefers the remote tags over older local ones', () => {
    outputs.set('git ls-remote --tags origin', LS_REMOTE);
    outputs.set('git tag -l', 'v1.3.0\nv1.5.4\n');

    expect(latestSemverTagVersion('/repo')).toBe('1.10.0');
  });

  it('falls back to local tags when the remote cannot be reached', () => {
    outputs.set('git ls-remote --tags origin', new Error('Could not resolve host: github.com'));
    outputs.set('git tag -l', 'v1.3.0\nv1.5.4\nnot-a-version\n');

    expect(listAvailableSemverVersions('/repo')).toEqual(['1.3.0', '1.5.4']);
  });

  it('falls back to local tags when the remote has no semver tags', () => {
    outputs.set('git ls-remote --tags origin', '28281095b47da2b7c131e213b356e64203af7e1a\trefs/tags/archive/next-2026-06\n');
    outputs.set('git tag -l', 'v1.5.4\n');

    expect(listAvailableSemverVersions('/repo')).toEqual(['1.5.4']);
  });

  it('returns nothing when neither source has a semver tag', () => {
    outputs.set('git ls-remote --tags origin', '');
    outputs.set('git tag -l', '');

    expect(listAvailableSemverVersions('/repo')).toEqual([]);
    expect(latestSemverTagVersion('/repo')).toBeNull();
  });
});
