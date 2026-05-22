#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

function fail(message) {
  console.error(`[telemetry-stamp] ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`[telemetry-stamp] ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseArgs(argv) {
  if (argv.length < 2) {
    fail('Usage: telemetry-stamp.mjs <install-method|bootstrap> <value> [--if-missing] [--source <source>] [--dir <path>]');
  }

  const [kind, value, ...rest] = argv;
  let ifMissing = false;
  let source;
  let dir;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--if-missing') {
      ifMissing = true;
      continue;
    }
    if (arg === '--source') {
      source = rest[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--dir') {
      dir = rest[index + 1];
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return { kind, value, ifMissing, source, dir };
}

function telemetryDir(override) {
  return override || process.env.NERVE_TELEMETRY_DIR || path.join(process.env.NERVE_PROJECT_ROOT || process.cwd(), '.nerve', 'telemetry');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(filePath, value) {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch (error) {
    warn(`Failed to write ${path.basename(filePath)}: ${errorMessage(error)}`);
  }
}

function isSource(value) {
  return value === 'install.sh' || value === 'setup' || value === 'runtime';
}

function inferSource(kind, value, explicitSource) {
  if (explicitSource) return explicitSource;
  if (kind === 'install-method') {
    if (value === 'release') return 'install.sh';
    if (value === 'source') return 'setup';
    return 'runtime';
  }
  if (value === 'upgrade_legacy') return 'runtime';
  return process.env.NERVE_TELEMETRY_STAMP_SOURCE || (process.env.NERVE_INSTALLER === '1' ? 'setup' : 'install.sh');
}

function isValidRecord(kind, data) {
  if (!data || typeof data !== 'object' || typeof data.stampedAt !== 'string' || !isSource(data.source)) {
    return false;
  }

  if (kind === 'install-method') {
    return data.installMethod === 'release' || data.installMethod === 'source' || data.installMethod === 'unknown';
  }

  return data.kind === 'fresh_install' || data.kind === 'upgrade_legacy';
}

const parsed = parseArgs(args);
const dir = telemetryDir(parsed.dir);
const source = inferSource(parsed.kind, parsed.value, parsed.source);

if (!isSource(source)) {
  fail(`Invalid source: ${source}`);
}

if (parsed.kind === 'install-method') {
  if (!['release', 'source', 'unknown'].includes(parsed.value)) {
    fail(`Invalid install method: ${parsed.value}`);
  }

  const filePath = path.join(dir, 'install-method.json');
  const current = readJson(filePath);
  if (parsed.ifMissing && isValidRecord('install-method', current)) {
    process.exit(0);
  }

  writeJson(filePath, {
    installMethod: parsed.value,
    stampedAt: new Date().toISOString(),
    source,
  });
  process.exit(0);
}

if (parsed.kind === 'bootstrap') {
  if (!['fresh_install', 'upgrade_legacy'].includes(parsed.value)) {
    fail(`Invalid bootstrap marker: ${parsed.value}`);
  }

  const filePath = path.join(dir, 'bootstrap.json');
  const current = readJson(filePath);
  if (parsed.ifMissing && isValidRecord('bootstrap', current)) {
    process.exit(0);
  }

  writeJson(filePath, {
    kind: parsed.value,
    stampedAt: new Date().toISOString(),
    source,
  });
  process.exit(0);
}

fail(`Unknown stamp kind: ${parsed.kind}`);
