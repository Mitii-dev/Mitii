import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { MAX_SKILL_DESCRIPTION_CHARS } from '../src/core/skills/skillLimits';

const bundledRoot = join(__dirname, '../src/core/skills/bundled');

function findSkillFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findSkillFiles(full));
    else if (entry === 'SKILL.md') out.push(full);
  }
  return out;
}

function parseDescription(content: string): string | undefined {
  const match = content.match(/^description:\s*(.+)$/m);
  return match?.[1]?.trim();
}

describe('bundled skills', () => {
  const skillFiles = findSkillFiles(bundledRoot);

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
});
