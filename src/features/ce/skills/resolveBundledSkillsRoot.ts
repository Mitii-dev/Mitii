import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CANDIDATE_SUFFIXES = [
  'src/features/ce/skills/bundled',
  'dist/features/ce/skills/bundled',
  'src/core/skills/bundled',
  'dist/core/skills/bundled',
] as const;

/** Resolve bundled skills root from the source tree or compiled extension output. */
export function resolveBundledSkillsRoot(packageRoot: string): string | undefined {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = join(packageRoot, suffix);
    if (hasSkillDirs(candidate)) return candidate;
  }
  return undefined;
}

function hasSkillDirs(root: string): boolean {
  if (!existsSync(root)) return false;
  try {
    return readdirSync(root).some((entry) => {
      const abs = join(root, entry);
      try {
        return statSync(abs).isDirectory() && existsSync(join(abs, 'SKILL.md'));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
