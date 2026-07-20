import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { MAX_SKILL_DESCRIPTION_CHARS } from '../src/features/ce/skills/skillLimits';
import { validateSkillManifest } from '../src/features/ce/skills/SkillManifestSchema';
import { SkillCatalogService } from '../src/features/ce/skills/SkillCatalogService';
import { SkillTestRunner } from '../src/features/ce/skills/SkillTestRunner';

const bundledRoot = join(__dirname, '../src/features/ce/skills/bundled');

function findSkillFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findSkillFiles(full));
    else if (entry === 'SKILL.md') out.push(full);
  }
  return out;
}

function findFiles(dir: string, target: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findFiles(full, target));
    else if (entry === target) out.push(full);
  }
  return out;
}

function parseDescription(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const lines = match[1].replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const lineMatch = lines[i].match(/^description:\s*(.*)$/);
    if (!lineMatch) continue;
    const value = lineMatch[1].trim();
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const indented: string[] = [];
      for (let c = i + 1; c < lines.length; c += 1) {
        if (/^\S/.test(lines[c])) break;
        if (!lines[c].trim()) {
          indented.push('');
          continue;
        }
        indented.push(lines[c].replace(/^\s+/, ''));
      }
      return value.startsWith('>')
        ? indented.join(' ').replace(/\s+/g, ' ').trim()
        : indented.join('\n').trim();
    }
    return value.replace(/^['"]|['"]$/g, '').trim();
  }
  return undefined;
}

describe('bundled skills', () => {
  const skillFiles = findSkillFiles(bundledRoot);
  const manifestFiles = findFiles(bundledRoot, 'skill.json');

  it('finds at least one bundled SKILL.md to validate', () => {
    expect(skillFiles.length).toBeGreaterThan(0);
  });

  for (const file of skillFiles) {
    const relPath = file.slice(bundledRoot.length + 1);
    it(`${relPath}: description stays within MAX_SKILL_DESCRIPTION_CHARS (${MAX_SKILL_DESCRIPTION_CHARS})`, () => {
      const content = readFileSync(file, 'utf8');
      const description = parseDescription(content);
      expect(description, `${relPath} is missing a frontmatter description`).toBeDefined();
      expect((description as string).length).toBeLessThanOrEqual(MAX_SKILL_DESCRIPTION_CHARS);
    });
  }

  it('parses bundled skill manifests with unique ids and valid referenced files', () => {
    const ids = new Set<string>();

    for (const file of manifestFiles) {
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      const validation = validateSkillManifest(manifest);

      expect(validation.issues, file).toEqual([]);
      expect(validation.success, file).toBe(true);
      expect(ids.has(validation.manifest!.id), `duplicate id ${validation.manifest!.id}`).toBe(false);
      ids.add(validation.manifest!.id);
      expect(existsSync(join(dirname(file), validation.manifest!.entrypoint)), `${file} entrypoint`).toBe(true);
      for (const ref of validation.manifest!.referenceFiles ?? []) {
        expect(existsSync(join(dirname(file), ref)), `${file} reference ${ref}`).toBe(true);
      }
    }
  });

  it('runs bundled manifest routing examples through the catalog selector', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'mitii-skills-'));
    try {
      const workspaceSkills = join(workspace, '.mitii', 'skills');
      cpSync(bundledRoot, workspaceSkills, { recursive: true });
      const catalog = new SkillCatalogService(workspace);
      catalog.refresh();
      const runner = new SkillTestRunner(catalog);

      for (const entry of catalog.listEntries()) {
        if ((entry.manifest.tests?.length ?? 0) === 0) continue;
        const result = runner.run(entry.id);
        expect(result.results, entry.id).toEqual(
          expect.arrayContaining(result.results.map(() => expect.objectContaining({ passed: true })))
        );
        expect(result.failed, entry.id).toBe(0);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
