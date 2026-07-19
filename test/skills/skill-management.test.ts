import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillCatalogService } from '../../src/features/ce/skills/SkillCatalogService';
import { SkillManagementService } from '../../src/features/ce/skills/SkillManagementService';
import { SkillTestRunner } from '../../src/features/ce/skills/SkillTestRunner';
import type { SkillManifest } from '../../src/interfaces/skills/SkillManifest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Skill management', () => {
  it('detects duplicate IDs and dependency cycles without aborting the catalog', () => {
    const root = workspace();
    writeSkill(root, 'one', { ...manifest('shared'), dependencies: ['two'] });
    writeSkill(root, 'two', { ...manifest('two'), dependencies: ['shared'] });
    writeSkill(root, 'duplicate', manifest('shared'));
    const catalog = new SkillCatalogService(root);
    catalog.refresh();
    const entries = catalog.listEntries();
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.issues.some((issue) => issue.code === 'duplicate_id'))).toHaveLength(1);
    expect(entries.filter((entry) => entry.issues.some((issue) => issue.code === 'dependency_cycle')).length).toBeGreaterThan(0);
  });

  it('validates drafts and saves with optimistic revisions', () => {
    const root = workspace();
    const catalog = new SkillCatalogService(root);
    catalog.refresh();
    const service = new SkillManagementService(root, catalog);
    const saved = service.repository.save({
      manifest: manifest('created'),
      content: '# Created\n\n## Quick Reference\n\nDo the work.',
      source: 'internal',
    });
    expect(service.repository.get('created')?.content).toContain('Quick Reference');
    expect(service.analyzeDraft(saved.manifest, saved.content).valid).toBe(true);
    expect(() => service.repository.save({
      manifest: saved.manifest,
      content: saved.content,
      source: 'internal',
    }, 'stale-revision')).toThrow(/changed on disk/i);
  });

  it('rejects unsafe IDs and executable entrypoints', () => {
    const root = workspace();
    const catalog = new SkillCatalogService(root);
    catalog.refresh();
    const service = new SkillManagementService(root, catalog);
    expect(() => service.repository.save({
      manifest: { ...manifest('../escape'), id: '../escape' },
      content: 'bad',
      source: 'internal',
    })).toThrow();
    expect(() => service.repository.save({
      manifest: { ...manifest('script'), entrypoint: 'run.sh' },
      content: 'bad',
      source: 'internal',
    })).toThrow(/SKILL.md/);
  });

  it('runs positive and negative routing cases with reasons', () => {
    const root = workspace();
    writeSkill(root, 'testable', {
      ...manifest('testable'),
      triggers: ['special workflow'],
      requiredTools: ['read_file'],
      tests: [
        {
          id: 'positive',
          name: 'positive',
          request: 'Use the special workflow',
          mode: 'agent',
          availableTools: ['read_file'],
          expected: 'selected',
        },
        {
          id: 'missing-tool',
          name: 'missing tool',
          request: 'Use the special workflow',
          mode: 'agent',
          availableTools: [],
          expected: 'rejected',
        },
      ],
    });
    const catalog = new SkillCatalogService(root);
    catalog.refresh();
    const result = new SkillTestRunner(catalog).run('testable');
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(2);
    expect(result.results.every((test) => test.reasons.length > 0)).toBe(true);
  });
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'mitii-skills-'));
  roots.push(root);
  mkdirSync(join(root, '.mitii', 'skills'), { recursive: true });
  return root;
}

function writeSkill(root: string, folder: string, skillManifest: SkillManifest): void {
  const directory = join(root, '.mitii', 'skills', folder);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${skillManifest.name}\ndescription: ${skillManifest.description}\n---\n\n# ${skillManifest.name}\n\n## Quick Reference\n\nGuidance.\n`);
  writeFileSync(join(directory, 'skill.json'), JSON.stringify(skillManifest, null, 2));
}

function manifest(id: string): SkillManifest {
  return {
    schemaVersion: 1,
    id,
    name: id,
    description: `Workflow ${id}`,
    version: '1.0.0',
    apiVersion: '1',
    owner: 'test',
    edition: 'ce',
    enabled: true,
    status: 'active',
    kind: 'workflow',
    supportedModes: ['agent'],
    entrypoint: 'SKILL.md',
    maxInjectionChars: 4_000,
    injectionStrategy: 'lazy-references',
    trust: 'managed',
    priority: 10,
  };
}
