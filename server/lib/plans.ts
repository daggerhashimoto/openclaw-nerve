import fs from 'node:fs/promises';
import path from 'node:path';

const PLAN_ROOT_NAME = '.plans';

function normalizeRepoRoot(repoRoot?: string): string {
  return path.resolve(repoRoot || process.cwd());
}

export function getPlansRoot(repoRoot?: string): string {
  return path.resolve(normalizeRepoRoot(repoRoot), PLAN_ROOT_NAME);
}

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

export function isArchivedPlanPath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).filter(Boolean).includes('archive');
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePlanContent(content: string): {
  frontmatter: {
    plan_id?: string;
    plan_title?: string;
    status?: string;
    bead_ids?: string[];
  };
  body: string;
} {
  if (!content.startsWith('---\n')) {
    return { frontmatter: {}, body: content };
  }

  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }

  const rawFrontmatter = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontmatter: {
    plan_id?: string;
    plan_title?: string;
    status?: string;
    bead_ids?: string[];
  } = {};
  let activeArrayKey: 'bead_ids' | null = null;

  for (const line of rawFrontmatter.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const arrayMatch = line.match(/^\s+-\s+(.*)$/);
    if (arrayMatch && activeArrayKey === 'bead_ids') {
      const next = stripWrappingQuotes(arrayMatch[1] ?? '');
      if (!frontmatter.bead_ids) frontmatter.bead_ids = [];
      if (next) frontmatter.bead_ids.push(next);
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!keyValueMatch) {
      activeArrayKey = null;
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    const value = rawValue.trim();
    if (key === 'bead_ids') {
      activeArrayKey = 'bead_ids';
      if (!value) {
        frontmatter.bead_ids = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter.bead_ids = value.slice(1, -1)
          .split(',')
          .map((item) => stripWrappingQuotes(item))
          .filter(Boolean);
      } else {
        frontmatter.bead_ids = [stripWrappingQuotes(value)].filter(Boolean);
      }
      continue;
    }

    activeArrayKey = null;
    if (key === 'plan_id' || key === 'plan_title' || key === 'status') {
      frontmatter[key] = stripWrappingQuotes(value);
    }
  }

  return { frontmatter, body };
}

function extractPlanTitle(content: string, frontmatter: { plan_title?: string }): string {
  if (frontmatter.plan_title?.trim()) return frontmatter.plan_title.trim();

  const { body } = parsePlanContent(content);
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('# ')) return trimmed.slice(2).trim();
  }

  return 'Untitled plan';
}

async function collectPlanFiles(dirPath: string, relativeDir = ''): Promise<string[]> {
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const item of items) {
    const childRelative = relativeDir ? path.posix.join(relativeDir, item.name) : item.name;
    const childAbsolute = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      files.push(...await collectPlanFiles(childAbsolute, childRelative));
      continue;
    }

    if (item.isFile() && isMarkdownFile(item.name)) {
      files.push(path.posix.join(PLAN_ROOT_NAME, childRelative));
    }
  }

  return files;
}

export interface RepoPlanSummary {
  path: string;
  title: string;
  status: string | null;
  planId: string | null;
  beadIds: string[];
  archived: boolean;
  updatedAt: number;
}

export async function listRepoPlans(repoRoot?: string): Promise<RepoPlanSummary[]> {
  const plansRoot = getPlansRoot(repoRoot);

  try {
    const stat = await fs.stat(plansRoot);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const relativePaths = await collectPlanFiles(plansRoot);
  const plans = await Promise.all(relativePaths.map(async (relativePath) => {
    const absolutePath = path.resolve(normalizeRepoRoot(repoRoot), relativePath);
    const [content, stat] = await Promise.all([
      fs.readFile(absolutePath, 'utf-8'),
      fs.stat(absolutePath),
    ]);
    const parsed = parsePlanContent(content);
    return {
      path: relativePath,
      title: extractPlanTitle(content, parsed.frontmatter),
      status: parsed.frontmatter.status?.trim() || null,
      planId: parsed.frontmatter.plan_id?.trim() || null,
      beadIds: parsed.frontmatter.bead_ids ?? [],
      archived: isArchivedPlanPath(relativePath),
      updatedAt: Math.floor(stat.mtimeMs),
    } satisfies RepoPlanSummary;
  }));

  return plans.sort((left, right) => {
    if (left.archived !== right.archived) return left.archived ? 1 : -1;
    return right.updatedAt - left.updatedAt;
  });
}

export async function findRepoPlanByBeadId(beadId: string, repoRoot?: string): Promise<RepoPlanSummary | null> {
  const normalizedBeadId = beadId.trim();
  if (!normalizedBeadId) return null;

  const plans = await listRepoPlans(repoRoot);
  return plans.find((plan) => plan.beadIds.includes(normalizedBeadId)) ?? null;
}
