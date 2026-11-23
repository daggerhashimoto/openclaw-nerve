/* @vitest-environment node */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MANAGED_ENV_KEYS,
  generateEnvContent,
  writeEnvFile,
  type EnvConfig,
} from './env-writer.js';

const PRESERVED_HEADER = '# Preserved from your previous .env (not managed by setup)';

const BASE_CONFIG: EnvConfig = {
  GATEWAY_TOKEN: 'gw-token',
  PORT: '3080',
};

describe('writeEnvFile with an existing .env', () => {
  let dir = '';
  let envPath = '';

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nerve-env-writer-'));
    envPath = path.join(dir, '.env');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Seed .env with `previous` (or leave it absent), write `config`, and return the new file. */
  function rewrite(previous: string | null, config: EnvConfig = BASE_CONFIG): string {
    if (previous !== null) writeFileSync(envPath, previous, 'utf-8');
    writeEnvFile(envPath, config);
    return readFileSync(envPath, 'utf-8');
  }

  /** The lines of a file that are not the generated timestamp, for comparing two runs. */
  function withoutTimestamp(content: string): string {
    return content.split('\n').filter((line) => !/^# \d{4}-\d{2}-\d{2}T/.test(line)).join('\n');
  }

  function lineCount(content: string, line: string): number {
    return content.split('\n').filter((l) => l === line).length;
  }

  it('keeps keys that setup does not manage, with their raw lines', () => {
    const previous = [
      'GATEWAY_TOKEN=old-token',
      'PORT=3080',
      'NERVE_PUBLIC_ORIGIN=https://nerve.example.com',
      'TRUSTED_PROXIES="10.0.0.0/8, 192.168.0.0/16"',
      "NERVE_WORKSPACE_REMOTE='true'",
      'MY_CUSTOM_KEY=has spaces # and an inline comment',
      '',
    ].join('\n');

    const out = rewrite(previous);

    expect(out).toContain('NERVE_PUBLIC_ORIGIN=https://nerve.example.com\n');
    expect(out).toContain('TRUSTED_PROXIES="10.0.0.0/8, 192.168.0.0/16"\n');
    expect(out).toContain("NERVE_WORKSPACE_REMOTE='true'\n");
    expect(out).toContain('MY_CUSTOM_KEY=has spaces # and an inline comment\n');

    // The server must read the same values from the new file as from the old one.
    const before = parseDotenv(previous);
    const after = parseDotenv(out);
    for (const key of ['NERVE_PUBLIC_ORIGIN', 'TRUSTED_PROXIES', 'NERVE_WORKSPACE_REMOTE', 'MY_CUSTOM_KEY']) {
      expect(after[key]).toBe(before[key]);
    }
  });

  it('puts the kept keys after the managed block, under one header', () => {
    const out = rewrite('GATEWAY_TOKEN=t\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n');

    const header = out.indexOf(PRESERVED_HEADER);
    expect(lineCount(out, PRESERVED_HEADER)).toBe(1);
    expect(header).toBeGreaterThan(out.indexOf('GATEWAY_TOKEN='));
    expect(header).toBeGreaterThan(out.indexOf('PORT='));
    expect(out.indexOf('NERVE_PUBLIC_ORIGIN=')).toBeGreaterThan(header);
    expect(out.endsWith('NERVE_PUBLIC_ORIGIN=https://nerve.example.com\n')).toBe(true);
  });

  it('keeps keys in their original order', () => {
    const out = rewrite('ZED=1\nALPHA=2\nMIDDLE=3\n');

    expect(out.indexOf('ZED=1')).toBeLessThan(out.indexOf('ALPHA=2'));
    expect(out.indexOf('ALPHA=2')).toBeLessThan(out.indexOf('MIDDLE=3'));
  });

  it('keeps keys that are in EnvConfig but that setup never writes', () => {
    const out = rewrite('TTS_CACHE_TTL_MS=60000\nTTS_CACHE_MAX=50\nVITE_PORT=5173\n');

    expect(out).toContain('TTS_CACHE_TTL_MS=60000\n');
    expect(out).toContain('TTS_CACHE_MAX=50\n');
    expect(out).toContain('VITE_PORT=5173\n');
  });

  it('updates the value of a managed key instead of keeping the old line', () => {
    const out = rewrite(
      'GATEWAY_TOKEN=old-token\nPORT=3080\nAGENT_NAME=Old Name\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n',
      { GATEWAY_TOKEN: 'new-token', PORT: '4000', AGENT_NAME: 'New Name' },
    );

    const env = parseDotenv(out);
    expect(env.GATEWAY_TOKEN).toBe('new-token');
    expect(env.PORT).toBe('4000');
    expect(env.AGENT_NAME).toBe('New Name');
    expect(out).not.toContain('old-token');
    expect(out).not.toContain('Old Name');
    expect(lineCount(out, 'PORT=4000')).toBe(1);
    expect(out.match(/^PORT=/gm)).toHaveLength(1);
  });

  it('removes a managed key that setup now leaves unset', () => {
    const previous = [
      'GATEWAY_TOKEN=old-token',
      'HOST=0.0.0.0',
      'ALLOWED_ORIGINS=http://192.168.1.5:3080',
      'CSP_CONNECT_EXTRA=http://192.168.1.5:3080 ws://192.168.1.5:3080',
      'WS_ALLOWED_HOSTS=192.168.1.5',
      'NERVE_AUTH=true',
      'NERVE_PASSWORD_HASH=abc123',
      'NERVE_SESSION_SECRET=secret',
      'OPENAI_API_KEY=sk-old',
      'NERVE_PUBLIC_ORIGIN=https://nerve.example.com',
      '',
    ].join('\n');

    // A switch to local-only access: none of the network keys are set any more.
    const out = rewrite(previous, { GATEWAY_TOKEN: 'new-token', PORT: '3080' });

    const env = parseDotenv(out);
    for (const key of [
      'HOST',
      'ALLOWED_ORIGINS',
      'CSP_CONNECT_EXTRA',
      'WS_ALLOWED_HOSTS',
      'NERVE_AUTH',
      'NERVE_PASSWORD_HASH',
      'NERVE_SESSION_SECRET',
      'OPENAI_API_KEY',
    ]) {
      expect(env, key).not.toHaveProperty(key);
    }
    expect(env.NERVE_PUBLIC_ORIGIN).toBe('https://nerve.example.com');
    expect(env.GATEWAY_TOKEN).toBe('new-token');
  });

  it('keeps only the last of a duplicated key, as dotenv does', () => {
    const previous = 'FIRST=1\nDUP=old\nSECOND=2\nDUP=new\n';

    const out = rewrite(previous);

    expect(out.match(/^DUP=/gm)).toHaveLength(1);
    expect(parseDotenv(out).DUP).toBe('new');
    expect(parseDotenv(out).DUP).toBe(parseDotenv(previous).DUP);
    expect(out.indexOf('FIRST=1')).toBeLessThan(out.indexOf('DUP=new'));
    expect(out.indexOf('SECOND=2')).toBeLessThan(out.indexOf('DUP=new'));
  });

  it('drops every old line of a duplicated managed key', () => {
    const out = rewrite('PORT=1111\nGATEWAY_TOKEN=a\nPORT=2222\n', { GATEWAY_TOKEN: 'b', PORT: '3080' });

    expect(out.match(/^PORT=/gm)).toHaveLength(1);
    expect(parseDotenv(out).PORT).toBe('3080');
  });

  it('does not treat commented-out assignments as keys', () => {
    const previous = [
      '# NERVE_PUBLIC_ORIGIN=https://disabled.example.com',
      '#PORT=1111',
      '  # TRUSTED_PROXIES=10.0.0.1',
      '',
      'REAL=1',
      '',
    ].join('\n');

    const out = rewrite(previous);

    const env = parseDotenv(out);
    expect(env.REAL).toBe('1');
    expect(env).not.toHaveProperty('NERVE_PUBLIC_ORIGIN');
    expect(env).not.toHaveProperty('TRUSTED_PROXIES');
    expect(env.PORT).toBe('3080');
    expect(out).not.toContain('disabled.example.com');
  });

  it('carries a comment directly above a kept key, and drops loose comments and blank lines', () => {
    const previous = [
      '# Nerve Configuration',
      '# Generated by `npm run setup`',
      '',
      '# OpenClaw Gateway',
      'GATEWAY_TOKEN=old-token',
      '',
      '# loose note about nothing',
      '',
      '# Public URL behind the reverse proxy',
      '# (must match the browser address)',
      'NERVE_PUBLIC_ORIGIN=https://nerve.example.com',
      '',
      '',
      'TRUSTED_PROXIES=10.0.0.1',
      '',
    ].join('\n');

    const out = rewrite(previous);

    expect(out).toContain(
      '# Public URL behind the reverse proxy\n# (must match the browser address)\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n',
    );
    expect(out).toContain('TRUSTED_PROXIES=10.0.0.1\n');
    expect(out).not.toContain('loose note');
    expect(out).not.toContain('\n\n\n');
    // The old generated header and the old section comment are replaced, not repeated.
    expect(lineCount(out, '# Nerve Configuration')).toBe(1);
    expect(lineCount(out, '# OpenClaw Gateway')).toBe(1);
  });

  it('writes an empty colon assignment so it cannot swallow the next key', () => {
    const previous = 'EMPTY: \nNEXT=ok\nexport ALSO_EMPTY:\t\nLAST=1\n';
    const out = rewrite(previous);
    const env = parseDotenv(out);
    expect(env.EMPTY).toBe('');
    expect(env.NEXT).toBe('ok');
    expect(env.ALSO_EMPTY).toBe('');
    expect(env.LAST).toBe('1');
    expect(env).toMatchObject(parseDotenv(previous));
  });

  it('carries a one-line comment that follows a managed key to the kept key below it', () => {
    const out = rewrite(
      'PORT=3080\n# public endpoint\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n',
    );

    expect(out).toContain('# public endpoint\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n');
    expect(lineCount(out, '# public endpoint')).toBe(1);
  });

  it('carries every line of a multi-line comment that follows a managed key', () => {
    const out = rewrite(
      'GATEWAY_TOKEN="old-token"\n# public endpoint\n# must match the browser address\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n',
    );

    expect(out).toContain(
      '# public endpoint\n# must match the browser address\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n',
    );
  });

  it('carries a comment that follows a managed key with an inline comment', () => {
    const out = rewrite('PORT=3080 # the port\n# why this is here\nFOO=1\n');

    expect(out).toContain('# why this is here\nFOO=1\n');
    expect(out).not.toContain('# the port');
  });

  it('does not keep a comment that belongs to a managed key below it', () => {
    const out = rewrite('FOO=1\n# about the port\nPORT=4000\nBAR=2\n');

    expect(out).toContain('FOO=1\n');
    expect(out).toContain('BAR=2\n');
    expect(out).not.toContain('about the port');
    expect(out).not.toMatch(/FOO=1\n#/);
  });

  it('keeps a comment that follows a kept key with the key below it, not the key above', () => {
    const out = rewrite('FIRST=1\n# about second\nSECOND=2\n');

    expect(out).toContain('FIRST=1\n# about second\nSECOND=2\n');
  });

  it('keeps an `export KEY=value` line as written, and lets a managed export be replaced', () => {
    const previous = 'export EXTRA_FLAG=1\nexport PORT=9999\nGATEWAY_TOKEN=old-token\n';

    const out = rewrite(previous);

    expect(out).toContain('export EXTRA_FLAG=1\n');
    expect(out).not.toContain('9999');
    const env = parseDotenv(out);
    expect(env.EXTRA_FLAG).toBe('1');
    expect(env.PORT).toBe('3080');
  });

  it('keeps the last line of a file with no trailing newline', () => {
    const out = rewrite('GATEWAY_TOKEN=old-token\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com');

    expect(out).toContain('\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\n');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n\n')).toBe(false);
  });

  it('does not carry carriage returns from a CRLF file', () => {
    const out = rewrite('GATEWAY_TOKEN=old-token\r\nFOO=1\r\nBAR="two"\r\n');

    expect(out).not.toContain('\r');
    expect(parseDotenv(out).FOO).toBe('1');
    expect(out).toContain('BAR="two"\n');
  });

  it('keeps a multi-line quoted value whole, with no line of it read as a key', () => {
    const previous = [
      'GATEWAY_TOKEN=old-token',
      'TLS_PEM="-----BEGIN KEY-----',
      'INNER=looks-like-a-key',
      'PORT=7777',
      '-----END KEY-----"',
      'AFTER=1',
      '',
    ].join('\n');

    const out = rewrite(previous);

    const env = parseDotenv(out);
    expect(env.TLS_PEM).toBe(parseDotenv(previous).TLS_PEM);
    expect(env.AFTER).toBe('1');
    expect(env.PORT).toBe('3080');
    expect(env).not.toHaveProperty('INNER');
  });

  it('writes no header when there is nothing to keep, matching a fresh file', () => {
    const fresh = rewrite(null);
    rmSync(envPath);
    const rewritten = rewrite('# only a comment\n\nGATEWAY_TOKEN=old-token\nPORT=3080\nHOST=0.0.0.0\n');

    expect(rewritten).not.toContain(PRESERVED_HEADER);
    expect(withoutTimestamp(rewritten)).toBe(withoutTimestamp(fresh));
  });

  it('writes a file with no old .env exactly as before', () => {
    const out = rewrite(null);

    expect(existsSync(envPath)).toBe(true);
    expect(withoutTimestamp(out)).toBe(withoutTimestamp(generateEnvContent(BASE_CONFIG)));
    expect(out).not.toContain(PRESERVED_HEADER);
  });

  it('is stable across repeated runs', () => {
    const first = rewrite(
      '# why\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\nTRUSTED_PROXIES=10.0.0.1\nDUP=1\nDUP=2\n',
    );
    writeEnvFile(envPath, BASE_CONFIG);
    const second = readFileSync(envPath, 'utf-8');
    writeEnvFile(envPath, BASE_CONFIG);
    const third = readFileSync(envPath, 'utf-8');

    expect(withoutTimestamp(second)).toBe(withoutTimestamp(first));
    expect(withoutTimestamp(third)).toBe(withoutTimestamp(first));
    expect(lineCount(third, PRESERVED_HEADER)).toBe(1);
    expect(lineCount(third, '# why')).toBe(1);
  });

  it('keeps nothing from the old file when asked not to preserve unmanaged keys', () => {
    writeFileSync(
      envPath,
      '# why\nNERVE_PUBLIC_ORIGIN=https://nerve.example.com\nTRUSTED_PROXIES=10.0.0.1\nPORT=1111\nHOST=0.0.0.0\n',
      'utf-8',
    );

    writeEnvFile(envPath, BASE_CONFIG, { preserveUnmanaged: false });

    const out = readFileSync(envPath, 'utf-8');
    const env = parseDotenv(out);
    expect(env).not.toHaveProperty('NERVE_PUBLIC_ORIGIN');
    expect(env).not.toHaveProperty('TRUSTED_PROXIES');
    expect(env).not.toHaveProperty('HOST');
    expect(env.PORT).toBe('3080');
    expect(out).not.toContain(PRESERVED_HEADER);
    expect(out).not.toContain('# why');
  });

  it('writes the same file with or without the old one when not preserving', () => {
    writeFileSync(envPath, 'FOO=1\nGATEWAY_TOKEN=old\n', 'utf-8');
    writeEnvFile(envPath, BASE_CONFIG, { preserveUnmanaged: false });
    const overOldFile = readFileSync(envPath, 'utf-8');
    rmSync(envPath);
    writeEnvFile(envPath, BASE_CONFIG, { preserveUnmanaged: false });

    expect(withoutTimestamp(overOldFile)).toBe(withoutTimestamp(readFileSync(envPath, 'utf-8')));
  });

  it('preserves by default and when preserveUnmanaged is true', () => {
    writeFileSync(envPath, 'FOO=1\n', 'utf-8');
    writeEnvFile(envPath, BASE_CONFIG, { preserveUnmanaged: true });
    expect(readFileSync(envPath, 'utf-8')).toContain('FOO=1\n');

    writeFileSync(envPath, 'FOO=2\n', 'utf-8');
    writeEnvFile(envPath, BASE_CONFIG);
    expect(readFileSync(envPath, 'utf-8')).toContain('FOO=2\n');
  });

  it('leaves no .env.tmp behind', () => {
    rewrite('FOO=1\n');

    expect(existsSync(`${envPath}.tmp`)).toBe(false);
  });
});

describe('MANAGED_ENV_KEYS', () => {
  it('lists exactly the keys generateEnvContent can write', () => {
    // Spelled out instead of built from MANAGED_ENV_KEYS, so dropping a key
    // from that list fails here. Required<> makes a new EnvConfig key fail to
    // compile until it is added below.
    const everything: Required<EnvConfig> = {
      GATEWAY_URL: 'http://gateway.example.com:18789',
      GATEWAY_TOKEN: 'value-of-GATEWAY_TOKEN',
      AGENT_NAME: 'Custom',
      PORT: '4000',
      HOST: '0.0.0.0',
      SSL_PORT: '4443',
      OPENAI_API_KEY: 'value-of-OPENAI_API_KEY',
      REPLICATE_API_TOKEN: 'value-of-REPLICATE_API_TOKEN',
      ALLOWED_ORIGINS: 'https://nerve.example.com',
      CSP_CONNECT_EXTRA: 'https://nerve.example.com',
      WS_ALLOWED_HOSTS: 'gateway.example.com',
      MEMORY_PATH: '/tmp/memory.md',
      MEMORY_DIR: '/tmp/memory',
      SESSIONS_DIR: '/tmp/sessions',
      USAGE_FILE: '/tmp/usage.json',
      FILE_BROWSER_ROOT: '/tmp/files',
      TTS_CACHE_TTL_MS: '1000',
      TTS_CACHE_MAX: '10',
      VITE_PORT: '5000',
      NERVE_AUTH: 'true',
      NERVE_PASSWORD_HASH: 'value-of-NERVE_PASSWORD_HASH',
      NERVE_SESSION_SECRET: 'value-of-NERVE_SESSION_SECRET',
      NERVE_SESSION_TTL: '3600',
    };

    const written = Object.keys(parseDotenv(generateEnvContent(everything, '')));

    expect(written.sort()).toEqual([...MANAGED_ENV_KEYS].sort());
  });

  it('leaves out the EnvConfig keys that setup never writes', () => {
    for (const key of ['TTS_CACHE_TTL_MS', 'TTS_CACHE_MAX', 'VITE_PORT']) {
      expect(MANAGED_ENV_KEYS).not.toContain(key);
    }
  });
});
