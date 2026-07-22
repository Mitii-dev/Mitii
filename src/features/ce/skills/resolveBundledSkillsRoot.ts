import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SOURCE_SUFFIXES = [
  'src/features/ce/skills/bundled',
  'src/core/skills/bundled',
] as const;

const DISTRIBUTION_SUFFIXES = [
  'dist/features/ce/skills/bundled',
  'dist/core/skills/bundled',
] as const;

export interface ResolveBundledSkillsRootOptions {
  explicitRoot?: string;
  prefer?: 'source' | 'distribution';
}

export interface BundledRootResolution {
  root?: string;
  checked: string[];
  errors: Array<{ path: string; reason: string }>;
}

/** Resolve bundled skills root from the source tree or compiled extension output. */
export function resolveBundledSkillsRoot(
  packageRoot: string,
  options: ResolveBundledSkillsRootOptions = {}
): string | undefined {
  return resolveBundledSkillsRootDetailed(packageRoot, options).root;
}

export function resolveBundledSkillsRootDetailed(
  packageRoot: string,
  options: ResolveBundledSkillsRootOptions = {}
): BundledRootResolution {
  const checked: string[] = [];
  const errors: Array<{ path: string; reason: string }> = [];

  const explicit = options.explicitRoot?.trim() || process.env.MITII_BUNDLED_SKILLS_ROOT?.trim();
  if (explicit) {
    checked.push(explicit);
    if (hasSkillDirs(explicit)) return { root: explicit, checked, errors };
    errors.push({ path: explicit, reason: 'Explicit bundled skills root is not valid' });
    return { root: undefined, checked, errors };
  }

  const prefer = options.prefer ?? (process.env.NODE_ENV === 'production' ? 'distribution' : 'source');
  const suffixes = prefer === 'distribution'
    ? [...DISTRIBUTION_SUFFIXES, ...SOURCE_SUFFIXES]
    : [...SOURCE_SUFFIXES, ...DISTRIBUTION_SUFFIXES];

  for (const suffix of suffixes) {
    const candidate = join(packageRoot, suffix);
    checked.push(candidate);
    try {
      if (hasSkillDirs(candidate)) return { root: candidate, checked, errors };
    } catch (error) {
      errors.push({
        path: candidate,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { root: undefined, checked, errors };
}

function hasSkillDirs(root: string): boolean {
  if (!existsSync(root)) return false;
  return readdirSync(root).some((entry) => {
    const abs = join(root, entry);
    try {
      return statSync(abs).isDirectory() && existsSync(join(abs, 'SKILL.md'));
    } catch {
      return false;
    }
  });
}
