import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  InMemorySkillsCatalog,
  type SkillDescriptor,
  type SkillsCatalogPort,
} from '@mitii/v8';

import { DEFAULT_HOST_SKILLS } from './defaultSkills';

export type DiskSkillContentMode = 'metadata' | 'body';

export interface LoadDiskSkillsOptions {
  /**
   * Workspace root used for the default upload room under
   * `<workspace>/.mitii/skills/<skill-id>/SKILL.md`.
   */
  workspaceRoot?: string;
  /**
   * Bundled skill directories shipped by a host or package. Each root may
   * contain either `SKILL.md` directly or child directories with skill files.
   */
  bundledRoots?: readonly string[];
  /** Extra roots for deployed/user-uploaded skill packs. */
  roots?: readonly string[];
  /** Include the SDK-bundled curated skill pack. Defaults to true. */
  includeBundled?: boolean;
  /**
   * `metadata` keeps injected prompt content tiny. `body` is available for
   * hosts that intentionally want full playbooks.
   */
  contentMode?: DiskSkillContentMode;
  includeDefaults?: boolean;
}

export interface DiskSkillManifest {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  intents?: readonly string[] | string;
  routes?: readonly string[] | string;
  tags?: readonly string[] | string;
  priority?: number | string;
  conflictGroup?: string;
  alwaysApply?: boolean | string;
  enabled?: boolean | string;
  when?: readonly string[] | string;
  instruction?: string;
}

interface ParsedSkillFile {
  manifest: DiskSkillManifest;
  body: string;
}

const SKILL_FILE_NAME = 'SKILL.md';
const DEFAULT_WORKSPACE_SKILLS_DIR = '.mitii/skills';
const VALID_ROUTES = new Set([
  'direct_answer',
  'repository_answer',
  'clarify',
  'diagnose',
  'plan',
  'execute',
]);

export function createFileSystemSkillsCatalog(
  options: LoadDiskSkillsOptions = {},
): SkillsCatalogPort {
  return {
    async list(): Promise<readonly SkillDescriptor[]> {
      const diskSkills = await loadDiskSkills(options);
      if (options.includeDefaults === false) {
        return diskSkills;
      }
      return new InMemorySkillsCatalog([
        ...DEFAULT_HOST_SKILLS,
        ...diskSkills,
      ]).list();
    },
  };
}

export async function loadDiskSkills(
  options: LoadDiskSkillsOptions = {},
): Promise<readonly SkillDescriptor[]> {
  const roots = resolveSkillRoots(options);
  if (roots.length === 0) {
    return [];
  }

  const byId = new Map<string, SkillDescriptor>();
  for (const root of roots) {
    const files = await findSkillFiles([root]);
    const loaded = await Promise.all(
      files.map((file) =>
        loadSkillFile(file, options.contentMode ?? 'metadata'),
      ),
    );
    for (const skill of loaded) {
      if (skill) {
        byId.set(skill.id, skill);
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function loadSkillFile(
  filePath: string,
  contentMode: DiskSkillContentMode,
): Promise<SkillDescriptor | undefined> {
  const raw = await readFile(filePath, 'utf8');
  const { manifest, body } = parseSkillFile(raw);
  if (normalizeBoolean(manifest.enabled, true) === false) {
    return undefined;
  }
  const folderId = basename(resolve(filePath, '..'));
  const id = normalizeId(manifest.id ?? manifest.name ?? folderId);
  if (!id) {
    return undefined;
  }

  const title = cleanScalar(manifest.title ?? manifest.name ?? id) ?? id;
  const description =
    cleanScalar(manifest.description) ?? firstMeaningfulParagraph(body);
  if (!description) {
    return undefined;
  }

  const content =
    contentMode === 'body'
      ? body.trim() || compactSkillContent({ title, description, manifest })
      : compactSkillContent({ title, description, manifest });

  return {
    id,
    title,
    content,
    intents: normalizeList(manifest.intents),
    routes: normalizeList(manifest.routes).filter((route) =>
      VALID_ROUTES.has(route),
    ) as SkillDescriptor['routes'],
    tags: normalizeList(manifest.tags),
    priority: normalizePriority(manifest.priority),
    ...(cleanScalar(manifest.conflictGroup)
      ? { conflictGroup: cleanScalar(manifest.conflictGroup) }
      : {}),
    alwaysApply: normalizeBoolean(manifest.alwaysApply, false),
  };
}

function resolveSkillRoots(options: LoadDiskSkillsOptions): string[] {
  const roots = [
    ...(options.includeBundled === false ? [] : [defaultBundledSkillsRoot()]),
    ...(options.bundledRoots ?? []),
    ...(options.workspaceRoot
      ? [join(options.workspaceRoot, DEFAULT_WORKSPACE_SKILLS_DIR)]
      : []),
    ...(options.roots ?? []),
  ];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function defaultBundledSkillsRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot =
    basename(here) === 'src' || basename(here) === 'dist'
      ? resolve(here, '..')
      : here;
  return join(packageRoot, 'skills');
}

async function findSkillFiles(roots: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const root of roots) {
    const rootStat = await safeStat(root);
    if (!rootStat) {
      continue;
    }
    if (rootStat.isFile() && basename(root) === SKILL_FILE_NAME) {
      found.push(root);
      continue;
    }
    if (!rootStat.isDirectory()) {
      continue;
    }

    const direct = join(root, SKILL_FILE_NAME);
    if (await isFile(direct)) {
      found.push(direct);
    }

    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue;
      }
      const candidate = join(root, entry.name, SKILL_FILE_NAME);
      if (await isFile(candidate)) {
        found.push(candidate);
      }
    }
  }
  return [...new Set(found)].sort();
}

async function isFile(path: string): Promise<boolean> {
  return (await safeStat(path))?.isFile() ?? false;
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function parseSkillFile(raw: string): ParsedSkillFile {
  if (!raw.startsWith('---')) {
    return { manifest: {}, body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end < 0) {
    return { manifest: {}, body: raw };
  }
  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  return { manifest: parseFrontmatter(yaml), body };
}

function parseFrontmatter(raw: string): DiskSkillManifest {
  const manifest: Record<string, unknown> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    manifest[key] = parseFrontmatterValue(value);
  }
  return manifest as DiskSkillManifest;
}

function parseFrontmatterValue(value: string): unknown {
  if (!value) {
    return '';
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return unquote(value);
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function compactSkillContent(params: {
  title: string;
  description: string;
  manifest: DiskSkillManifest;
}): string {
  const lines = [
    `Skill: ${params.title}`,
    `Description: ${params.description}`,
  ];
  const when = normalizeList(params.manifest.when);
  if (when.length > 0) {
    lines.push(`Use when: ${when.join('; ')}`);
  }
  const instruction = cleanScalar(params.manifest.instruction);
  if (instruction) {
    lines.push(`Instruction: ${instruction}`);
  }
  return lines.join('\n');
}

function normalizeId(value: unknown): string | undefined {
  const id = cleanScalar(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || undefined;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanScalar(item))
      .filter((item): item is string => Boolean(item));
  }
  return cleanScalar(value)
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function normalizePriority(value: unknown): number {
  const numeric =
    typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 100;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

function cleanScalar(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const cleaned = String(value).trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function firstMeaningfulParagraph(body: string): string | undefined {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/^#+\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .find((paragraph) => paragraph.length > 0);
}
