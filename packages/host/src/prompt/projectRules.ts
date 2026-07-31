import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface ProjectRuleBlock {
  id: string;
  title?: string;
  content: string;
  priority: number;
}

const MAX_RULE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 24_000;

export interface LoadProjectRulesOptions {
  workspaceRoot: string;
  /** Cap for a single rule file body (characters). */
  maxRuleChars?: number;
  /** Cap across all loaded rule bodies (characters). */
  maxTotalChars?: number;
}

/**
 * Load host project instructions for Prompt Construction `projectRules`.
 *
 * Order (each file is its own block):
 * 1. AGENTS.md (repo root)
 * 2. Markdown files under .mitii/rules/
 * 3. MITTII.local.md (personal overlay)
 */
export async function loadProjectRules(
  options: LoadProjectRulesOptions,
): Promise<readonly ProjectRuleBlock[]> {
  const maxRuleChars = options.maxRuleChars ?? MAX_RULE_CHARS;
  const maxTotalChars = options.maxTotalChars ?? MAX_TOTAL_CHARS;
  const root = options.workspaceRoot;
  const blocks: ProjectRuleBlock[] = [];
  let totalChars = 0;

  const candidates: Array<{ id: string; title: string; path: string; priority: number }> = [
    {
      id: 'agents-md',
      title: 'AGENTS.md',
      path: join(root, 'AGENTS.md'),
      priority: 200,
    },
  ];

  for (const rulePath of await listMitiiRuleFiles(join(root, '.mitii', 'rules'))) {
    candidates.push({
      id: `mitii-rule:${basename(rulePath, '.md')}`,
      title: basename(rulePath),
      path: rulePath,
      priority: 150,
    });
  }

  candidates.push({
    id: 'mitii-local',
    title: 'MITTII.local.md',
    path: join(root, 'MITTII.local.md'),
    priority: 250,
  });

  for (const candidate of candidates) {
    if (totalChars >= maxTotalChars) {
      break;
    }
    const content = await readTextFile(candidate.path);
    if (!content) {
      continue;
    }
    const remaining = maxTotalChars - totalChars;
    const clipped = clipText(content, Math.min(maxRuleChars, remaining));
    if (!clipped.trim()) {
      continue;
    }
    blocks.push({
      id: candidate.id,
      title: candidate.title,
      content: clipped,
      priority: candidate.priority,
    });
    totalChars += clipped.length;
  }

  return blocks;
}

async function listMitiiRuleFiles(rulesDir: string): Promise<string[]> {
  const found: string[] = [];
  await walkMarkdown(rulesDir, found);
  return found.sort((a, b) => a.localeCompare(b));
}

async function walkMarkdown(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path, 'utf8');
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n…[truncated]`;
}
