import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { basename, dirname, join, relative } from 'path';
import type { ContextItem, ContextQuery, ContextSource } from '../../../features/ce/context/types';
import type { SkillManifest } from '../../../interfaces/skills/SkillManifest';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { AGENT_NAME } from '../../../shared/brand';
import {
  MAX_SKILL_DESCRIPTION_CHARS,
  MAX_SKILL_WALK_DEPTH,
  RECOMMENDED_SKILL_BODY_CHARS,
} from './skillLimits';
import { legacySkillManifest, validateSkillManifest, type SkillValidationIssue } from './SkillManifestSchema';

const log = createLogger('SkillCatalog');

export interface SkillCatalogItem {
  name: string;
  description: string;
  relPath: string;
}

export interface SkillCatalogEntry extends SkillCatalogItem {
  id: string;
  manifest: SkillManifest;
  valid: boolean;
  issues: SkillValidationIssue[];
  /** Absolute path to this skill's skill.json (or its SKILL.md when no manifest file exists). */
  manifestPath: string;
  /** Short content hash of the resolved manifest — lets telemetry tell two builds/copies of the same skill id apart. */
  manifestHash: string;
}

export class SkillCatalogService {
  private entries: SkillCatalogEntry[] = [];
  private entriesById = new Map<string, SkillCatalogEntry>();
  private aliases = new Map<string, string>();

  constructor(private readonly workspace: string) {}

  refresh(): SkillCatalogItem[] {
    const root = this.skillsRoot();
    if (!existsSync(root)) {
      this.entries = [];
      this.rebuildIndexes();
      return [];
    }

    const skillFiles = findSkillFiles(root);
    const provisionalEntries = skillFiles.map((absPath) => {
      const content = readFileSync(absPath, 'utf8');
      const frontmatter = parseSkillFrontmatter(content);
      const folderName = skillNameFromPath(absPath);
      const name = frontmatter.name || folderName;
      const description = extractDescription(content, frontmatter);
      const relPath = relative(this.workspace, absPath).replace(/\\/g, '/');
      const manifestPath = join(dirname(absPath), 'skill.json');
      const rawManifest = readJson(manifestPath);
      const validation = rawManifest === undefined
        ? { success: true, manifest: legacySkillManifest({ id: folderName, name, description }), issues: [] }
        : validateSkillManifest(rawManifest);
      const manifest = validation.manifest ?? legacySkillManifest({ id: folderName, name, description });
      const issues = [...validation.issues];

      if (!frontmatter.name || !frontmatter.description) {
        log.warn('Skill missing required frontmatter fields', {
          relPath,
          hasName: Boolean(frontmatter.name),
          hasDescription: Boolean(frontmatter.description),
        });
      }
      if (frontmatter.name && frontmatter.name !== folderName) {
        log.warn('Skill frontmatter name does not match folder', {
          relPath,
          frontmatterName: frontmatter.name,
          folderName,
        });
      }
      if ((frontmatter.description?.length ?? 0) > MAX_SKILL_DESCRIPTION_CHARS) {
        log.warn('Skill description exceeds catalog limit and will be truncated', {
          relPath,
          length: frontmatter.description!.length,
          limit: MAX_SKILL_DESCRIPTION_CHARS,
        });
      }
      if (content.length > RECOMMENDED_SKILL_BODY_CHARS) {
        log.debug('Skill body exceeds recommended size; prefer Quick Reference + references/', {
          relPath,
          chars: content.length,
          recommended: RECOMMENDED_SKILL_BODY_CHARS,
        });
      }

      return {
        id: manifest.id,
        name,
        description,
        relPath,
        manifest,
        valid: issues.length === 0,
        issues,
        manifestPath: rawManifest === undefined ? absPath : manifestPath,
        manifestHash: hashManifest(rawManifest ?? manifest),
      };
    });

    const idCounts = new Map<string, number>();
    for (const entry of provisionalEntries) {
      idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
    }
    const knownIds = new Set(provisionalEntries.map((entry) => entry.id));
    this.entries = provisionalEntries.map((entry) => {
      let issues = [...entry.issues];
      if ((idCounts.get(entry.id) ?? 0) > 1) {
        issues.push({
          path: 'id',
          code: 'duplicate_id',
          message: `Duplicate skill id: ${entry.id}`,
        });
      }
      const dependencies = resolveSkillDependencies(entry.manifest);
      for (const dependency of dependencies) {
        if (!knownIds.has(dependency)) {
          issues.push({
            path: 'dependencies',
            code: 'missing_dependency',
            message: `Missing skill dependency: ${dependency}`,
          });
        }
      }
      return {
        ...entry,
        issues,
        valid: issues.length === 0,
      };
    });

    const cycleIds = detectDependencyCycles(this.entries);
    if (cycleIds.size > 0) {
      this.entries = this.entries.map((entry) => cycleIds.has(entry.id)
        ? {
            ...entry,
            valid: false,
            issues: [...entry.issues, {
              path: 'dependencies',
              code: 'dependency_cycle',
              message: 'Skill dependency cycle detected',
            }],
          }
        : entry);
    }
    this.rebuildIndexes();

    this.writeCatalog();
    log.info('Skill catalog refreshed', { count: this.entries.length });
    return this.list();
  }

  list(): SkillCatalogItem[] {
    return this.entries.map(({ name, description, relPath }) => ({ name, description, relPath }));
  }

  listEntries(): SkillCatalogEntry[] {
    return [...this.entries];
  }

  get(name: string): { entry: SkillCatalogEntry; content: string } | undefined {
    const normalized = name.trim().toLowerCase();
    const id = this.aliases.get(normalized) ?? normalized;
    const entry = this.entriesById.get(id);
    if (!entry) return undefined;
    return {
      entry,
      content: readFileSync(join(this.workspace, entry.relPath), 'utf8'),
    };
  }

  search(query: string, limit = 10): SkillCatalogEntry[] {
    const terms = tokenize(query);
    return this.entries
      .filter((entry) => entry.valid)
      .map((entry) => ({ entry, score: catalogScore(entry, terms) }))
      .filter((item) => terms.length === 0 || item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.manifest.priority - a.entry.manifest.priority || a.entry.id.localeCompare(b.entry.id))
      .slice(0, Math.max(0, limit))
      .map((item) => item.entry);
  }

  private rebuildIndexes(): void {
    this.entriesById = new Map();
    this.aliases = new Map();
    for (const entry of this.entries) {
      if (!this.entriesById.has(entry.id)) this.entriesById.set(entry.id, entry);
      this.aliases.set(entry.id.toLowerCase(), entry.id);
      this.aliases.set(entry.name.toLowerCase(), entry.id);
      this.aliases.set(basename(dirname(entry.relPath)).toLowerCase(), entry.id);
    }
  }

  private skillsRoot(): string {
    return join(this.workspace, '.mitii', 'skills');
  }

  private writeCatalog(): void {
    const root = this.skillsRoot();
    mkdirSync(root, { recursive: true });
    const destination = join(root, 'catalog.json');
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.list(), null, 2)}\n`, 'utf8');
    renameSync(temporary, destination);
  }
}

/**
 * Skills are on-demand task workflows/playbooks, exposed as a catalog and loaded by use_skill.
 * Use ProjectRulesService for always-on workspace policy that must apply to every task.
 */
export class SkillCatalogContextSource implements ContextSource {
  id = 'skill-catalog';

  constructor(private readonly catalog: SkillCatalogService) {}

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    if (query.tierPolicy?.skillInjection === 'none') return [];
    const entries = this.catalog.search(query.text, 8);
    if (entries.length === 0) return [];
    const content = [
      `## Available ${AGENT_NAME} Skills`,
      'Use the use_skill tool with one of these names when the playbook applies:',
      ...entries.map((entry) => `- ${entry.name}: ${entry.description} (${entry.relPath})`),
    ].join('\n');
    return [{
      id: 'skill-catalog',
      source: 'skill-catalog',
      relPath: '.mitii/skills/catalog.json',
      content,
      score: 3,
      reason: 'Workspace skill catalog',
      tokenEstimate: Math.ceil(content.length / 4),
    }];
  }
}

function findSkillFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SKILL_WALK_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const abs = join(dir, entry);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1);
      } else if (entry === 'SKILL.md') {
        out.push(abs);
      }
    }
  };
  walk(root, 0);
  return out.sort();
}

function skillNameFromPath(skillPath: string): string {
  return basename(dirname(skillPath));
}

function extractDescription(
  content: string,
  frontmatter: { name?: string; description?: string } = parseSkillFrontmatter(content)
): string {
  if (frontmatter.description) return frontmatter.description.slice(0, MAX_SKILL_DESCRIPTION_CHARS);

  const lines = stripSkillFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('---'));
  return (lines[0] ?? 'Workspace skill playbook').slice(0, MAX_SKILL_DESCRIPTION_CHARS);
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const block = match[1];
  const name = readYamlScalar(block, 'name');
  const description = readYamlScalar(block, 'description');
  return { name, description };
}

export function stripSkillFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '');
}

function readYamlScalar(block: string, key: string): string | undefined {
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`));
    if (!match) continue;

    const value = match[1].trim();
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const folded = value.startsWith('>');
      const indented: string[] = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const childLine = lines[child];
        if (/^\S/.test(childLine)) break;
        if (!childLine.trim()) {
          indented.push('');
          continue;
        }
        indented.push(childLine.replace(/^\s{1,}/, ''));
      }
      const joined = folded
        ? indented.join(' ').replace(/\s+/g, ' ').trim()
        : indented.join('\n').trim();
      return cleanYamlScalar(joined);
    }

    return cleanYamlScalar(value);
  }
  return undefined;
}

function cleanYamlScalar(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1(?:\s+#.*)?$/);
  const cleaned = quoted ? quoted[2] : trimmed.replace(/\s+#.*$/, '');
  return cleaned.trim() || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hashManifest(manifest: unknown): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 12);
}

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    log.warn('Could not parse skill manifest', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9+#._-]+/).filter((term) => term.length > 1))];
}

function catalogScore(entry: SkillCatalogEntry, terms: string[]): number {
  if (terms.length === 0) return entry.manifest.priority;
  const fields = [
    entry.id,
    entry.name,
    entry.description,
    ...(entry.manifest.triggers ?? []),
    ...(entry.manifest.intents ?? []),
    ...(entry.manifest.taskKinds ?? []),
    ...(entry.manifest.taskSubtypes ?? []),
    ...(entry.manifest.tags ?? []),
  ].map((value) => value.toLowerCase());
  let score = 0;
  for (const term of terms) {
    if (entry.id.toLowerCase() === term || entry.name.toLowerCase() === term) score += 20;
    for (const field of fields) {
      if (field === term) score += 8;
      else if (field.includes(term)) score += 2;
    }
  }
  return score;
}

function detectDependencyCycles(entries: SkillCatalogEntry[]): Set<string> {
  const dependencies = new Map(entries.map((entry) => [
    entry.id,
    resolveSkillDependencies(entry.manifest),
  ]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();

  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      for (const item of path.slice(Math.max(0, start))) cyclic.add(item);
      cyclic.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency)) visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const id of dependencies.keys()) visit(id, []);
  return cyclic;
}

function resolveSkillDependencies(manifest: SkillManifest): string[] {
  const dependencies = manifest.dependencies;
  if (dependencies !== undefined) return [...dependencies];
  return [...(manifest.requires ?? [])];
}

export { parseSkillFrontmatter };
