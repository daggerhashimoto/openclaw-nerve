import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findProjectRootFromDirectory(startDir: string): string | undefined {
  let current = path.resolve(startDir);

  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function resolveProjectRoot(importMetaUrl?: string): string {
  const configuredRoot = process.env.NERVE_PROJECT_ROOT?.trim();
  if (configuredRoot) {
    const resolved = path.resolve(configuredRoot);
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(resolved).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (isDirectory && fs.existsSync(path.join(resolved, 'package.json'))) return resolved;
    throw new Error(`NERVE_PROJECT_ROOT does not contain package.json: ${resolved}`);
  }

  if (importMetaUrl) {
    const moduleDir = path.dirname(fileURLToPath(importMetaUrl));
    const moduleRoot = findProjectRootFromDirectory(moduleDir);
    if (moduleRoot) return moduleRoot;
  }

  return findProjectRootFromDirectory(process.cwd()) ?? process.cwd();
}
