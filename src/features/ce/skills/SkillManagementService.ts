import { createHash, randomUUID } from 'crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import type {
  SkillDocument,
  SkillRepository,
  SkillRepositoryPage,
  SkillRepositoryQuery,
} from '../../../interfaces/skills/SkillRepository';
import type { SkillManifest } from '../../../interfaces/skills/SkillManifest';
import { SkillCatalogService } from './SkillCatalogService';
import { validateSkillManifest, type SkillValidationIssue } from './SkillManifestSchema';
import { extractModeContribution } from './SkillInjectionBuilder';

export interface SkillCatalogItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  status: SkillManifest['status'];
  modes: readonly string[];
  priority: number;
  valid: boolean;
  issues: SkillValidationIssue[];
  source: SkillDocument['source'];
  revision: string;
}

export interface SkillDraftAnalysis {
  valid: boolean;
  issues: SkillValidationIssue[];
  estimatedFullChars: number;
  estimatedTokens: number;
  quickReference: string;
  modePreviews: Record<'ask' | 'plan' | 'agent', string>;
}

export class FileSkillRepository implements SkillRepository {
  constructor(
    private readonly workspace: string,
    private readonly catalog: SkillCatalogService
  ) {}

  search(query: SkillRepositoryQuery): SkillRepositoryPage {
    const text = query.text?.trim().toLowerCase() ?? '';
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));
    const matching = this.catalog.listEntries().filter((entry) => {
      if (query.enabled !== undefined && entry.manifest.enabled !== query.enabled) return false;
      if (query.modes?.length && !query.modes.some((mode) => entry.manifest.supportedModes.includes(mode as never))) return false;
      return !text || [entry.id, entry.name, entry.description, ...(entry.manifest.tags ?? [])]
        .some((field) => field.toLowerCase().includes(text));
    });
    matching.sort((left, right) => {
      if (query.sort === 'priority') return right.manifest.priority - left.manifest.priority || left.name.localeCompare(right.name);
      if (query.sort === 'updated') return (right.manifest.updatedAt ?? '').localeCompare(left.manifest.updatedAt ?? '') || left.name.localeCompare(right.name);
      return left.name.localeCompare(right.name);
    });
    return {
      items: matching.slice(offset, offset + limit).map((entry) => entry.manifest),
      total: matching.length,
      limit,
      offset,
    };
  }

  get(id: string): SkillDocument | undefined {
    const skill = this.catalog.get(id);
    if (!skill) return undefined;
    return {
      manifest: skill.entry.manifest,
      content: skill.content,
      revision: revisionOf(skill.entry.manifest, skill.content),
      source: sourceFor(skill.entry.manifest),
    };
  }

  save(document: Omit<SkillDocument, 'revision'>, expectedRevision?: string): SkillDocument {
    const validation = validateSkillManifest(document.manifest);
    if (!validation.success || !validation.manifest) {
      throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    }
    const existing = this.get(validation.manifest.id);
    const manifest = {
      ...validation.manifest,
      trust: existing?.manifest.trust ?? 'workspace',
    };
    assertSafeSkillId(manifest.id);
    assertDataOnlyManifest(manifest);
    if (expectedRevision !== undefined && existing?.revision !== expectedRevision) {
      throw new Error('Skill changed on disk; reload before saving');
    }
    const root = this.skillsRoot();
    const directory = safeChild(root, manifest.id);
    assertNoEscapingSymlink(root, directory);
    mkdirSync(directory, { recursive: true });
    atomicWrite(join(directory, 'SKILL.md'), document.content);
    atomicWrite(join(directory, 'skill.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    this.catalog.refresh();
    return this.get(manifest.id)!;
  }

  delete(id: string, expectedRevision?: string): void {
    assertSafeSkillId(id);
    const existing = this.get(id);
    if (!existing) return;
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
      throw new Error('Skill changed on disk; reload before deleting');
    }
    const directory = safeChild(this.skillsRoot(), id);
    assertNoEscapingSymlink(this.skillsRoot(), directory);
    rmSync(directory, { recursive: true, force: true });
    this.catalog.refresh();
  }

  private skillsRoot(): string {
    return join(this.workspace, '.mitii', 'skills');
  }
}

export class SkillManagementService {
  readonly repository: FileSkillRepository;

  constructor(
    workspace: string,
    private readonly catalog: SkillCatalogService
  ) {
    this.repository = new FileSkillRepository(workspace, catalog);
  }

  list(query: SkillRepositoryQuery = {}): { items: SkillCatalogItem[]; total: number } {
    const page = this.repository.search(query);
    return {
      total: page.total,
      items: page.items.map((manifest) => {
        const entry = this.catalog.get(manifest.id)!.entry;
        const document = this.repository.get(manifest.id)!;
        return {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          enabled: manifest.enabled,
          status: manifest.status,
          modes: manifest.supportedModes,
          priority: manifest.priority,
          valid: entry.valid,
          issues: entry.issues,
          source: document.source,
          revision: document.revision,
        };
      }),
    };
  }

  analyzeDraft(manifestInput: unknown, content: string): SkillDraftAnalysis {
    const validation = validateSkillManifest(manifestInput);
    const modePreviews = {
      ask: extractModeContribution(content, 'ask', 'quick-ref', validation.manifest?.description).content,
      plan: extractModeContribution(content, 'plan', 'quick-ref', validation.manifest?.description).content,
      agent: extractModeContribution(content, 'agent', 'quick-ref', validation.manifest?.description).content,
    };
    return {
      valid: validation.success,
      issues: validation.issues,
      estimatedFullChars: content.length,
      estimatedTokens: Math.ceil(content.length / 4),
      quickReference: modePreviews.plan,
      modePreviews,
    };
  }
}

function sourceFor(manifest: SkillManifest): SkillDocument['source'] {
  if (manifest.trust === 'builtin') return 'builtin';
  if (manifest.trust === 'installed') return 'installed';
  if (manifest.trust === 'managed') return 'internal';
  return 'repository';
}

function revisionOf(manifest: SkillManifest, content: string): string {
  return createHash('sha256')
    .update(JSON.stringify(manifest))
    .update('\0')
    .update(content)
    .digest('hex')
    .slice(0, 24);
}

function assertSafeSkillId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id === '.' || id === '..') {
    throw new Error(`Unsafe skill id: ${id}`);
  }
}

function assertDataOnlyManifest(manifest: SkillManifest): void {
  if (manifest.entrypoint !== 'SKILL.md') throw new Error('Skill entrypoint must be SKILL.md');
  for (const file of manifest.referenceFiles ?? []) {
    if (file.startsWith('/') || file.includes('..') || file.includes('\\')) {
      throw new Error(`Unsafe skill reference path: ${file}`);
    }
  }
}

function safeChild(root: string, child: string): string {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(root, child);
  if (resolvedChild !== resolvedRoot && !resolvedChild.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Skill path escapes the skill root');
  }
  return resolvedChild;
}

function assertNoEscapingSymlink(root: string, target: string): void {
  if (!existsSync(target)) return;
  if (lstatSync(target).isSymbolicLink()) throw new Error('Skill directory cannot be a symbolic link');
  const realRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const realTarget = realpathSync(target);
  if (relative(realRoot, realTarget).startsWith('..')) throw new Error('Skill directory escapes the skill root');
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}
