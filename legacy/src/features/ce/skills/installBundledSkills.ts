import { createHash } from 'crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { resolveBundledSkillsRoot } from './resolveBundledSkillsRoot';
import { parseSkillFrontmatter } from './SkillCatalogService';
import { MAX_SKILL_DESCRIPTION_CHARS } from './skillLimits';

const log = createLogger('BundledSkills');
const MANIFEST_FILE = '.bundled-skills.json';

export interface InstallBundledSkillsResult {
  installed: string[];
  skipped: string[];
  bundledRoot: string;
  destinationRoot: string;
}

interface BundledSkillsManifest {
  version: 1;
  skills: Record<string, {
    sourceHash: string;
    installedHash: string;
  }>;
}

/** Copy extension-bundled skills into the workspace `.mitii/skills` folder (idempotent). */
export function installBundledSkills(
  workspace: string,
  extensionRoot: string,
  options: { force?: boolean } = {}
): InstallBundledSkillsResult {
  const bundledRoot = resolveBundledSkillsRoot(extensionRoot);
  const destinationRoot = join(workspace, '.mitii', 'skills');
  const installed: string[] = [];
  const skipped: string[] = [];

  if (!bundledRoot || !existsSync(bundledRoot)) {
    log.warn('Bundled skills directory missing', { extensionRoot });
    return { installed, skipped, bundledRoot: bundledRoot ?? '', destinationRoot };
  }

  mkdirSync(destinationRoot, { recursive: true });
  const manifestPath = join(destinationRoot, MANIFEST_FILE);
  const manifest = readManifest(manifestPath);

  for (const skillDir of listBundledSkillDirs(bundledRoot)) {
    const skillName = basename(skillDir);
    const sourceSkillFile = join(skillDir, 'SKILL.md');
    const targetDir = join(destinationRoot, skillName);

    if (!existsSync(sourceSkillFile)) {
      log.warn('Bundled skill missing SKILL.md', { skillName, sourceSkillFile });
      continue;
    }

    const targetSkillFile = join(targetDir, 'SKILL.md');
    const sourceHash = hashDirectory(skillDir);
    const targetExists = existsSync(targetDir);
    const previous = manifest.skills[skillName];
    const targetHash = targetExists ? hashDirectory(targetDir) : undefined;

    if (
      targetExists &&
      !options.force &&
      (previous?.sourceHash === sourceHash || (!previous && targetHash === sourceHash))
    ) {
      if (!previous && targetHash === sourceHash) {
        manifest.skills[skillName] = { sourceHash, installedHash: targetHash };
      }
      skipped.push(skillName);
      continue;
    }

    if (
      targetExists &&
      !options.force &&
      previous &&
      previous.installedHash !== targetHash &&
      previous.sourceHash !== sourceHash
    ) {
      log.warn('Bundled skill has local changes; leaving workspace copy in place', {
        skillName,
        targetDir,
      });
      skipped.push(skillName);
      continue;
    }

    mkdirSync(targetDir, { recursive: true });
    cpSync(skillDir, targetDir, {
      recursive: true,
      force: true,
      filter: (src) => basename(src) !== '.git',
    });

    if (!existsSync(targetSkillFile)) {
      cpSync(sourceSkillFile, targetSkillFile);
    }

    installed.push(skillName);
    manifest.skills[skillName] = {
      sourceHash,
      installedHash: hashDirectory(targetDir),
    };
  }

  writeManifest(manifestPath, manifest);

  if (installed.length > 0 || skipped.length > 0) {
    log.info('Bundled skills install finished', {
      installed: installed.length,
      skipped: skipped.length,
      destinationRoot,
    });
  }

  return { installed, skipped, bundledRoot, destinationRoot };
}

export function listBundledSkillNames(extensionRoot: string): string[] {
  const bundledRoot = resolveBundledSkillsRoot(extensionRoot);
  if (!bundledRoot || !existsSync(bundledRoot)) return [];
  return listBundledSkillDirs(bundledRoot).map((dir) => basename(dir)).sort();
}

export function readBundledSkillManifest(extensionRoot: string): Array<{ name: string; description: string }> {
  const bundledRoot = resolveBundledSkillsRoot(extensionRoot);
  if (!bundledRoot || !existsSync(bundledRoot)) return [];

  return listBundledSkillDirs(bundledRoot).map((dir) => {
    const content = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const name = basename(dir);
    const description = extractBundledDescription(content) ?? `Bundled ${name} skill`;
    return { name, description };
  });
}

function listBundledSkillDirs(bundledRoot: string): string[] {
  return readdirSync(bundledRoot)
    .map((entry) => join(bundledRoot, entry))
    .filter((absPath) => {
      try {
        return statSync(absPath).isDirectory() && existsSync(join(absPath, 'SKILL.md'));
      } catch {
        return false;
      }
    })
    .sort();
}

function extractBundledDescription(content: string): string | undefined {
  const description = parseSkillFrontmatter(content).description;
  return description?.slice(0, MAX_SKILL_DESCRIPTION_CHARS);
}

function readManifest(path: string): BundledSkillsManifest {
  if (!existsSync(path)) return { version: 1, skills: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BundledSkillsManifest>;
    if (parsed.version === 1 && parsed.skills && typeof parsed.skills === 'object') {
      return { version: 1, skills: parsed.skills as BundledSkillsManifest['skills'] };
    }
  } catch (error) {
    log.warn('Could not read bundled skills manifest; it will be recreated', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { version: 1, skills: {} };
}

function writeManifest(path: string, manifest: BundledSkillsManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function hashDirectory(root: string): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === '.git') continue;
      const absPath = join(dir, entry);
      const st = statSync(absPath);
      if (st.isDirectory()) {
        walk(absPath);
      } else if (st.isFile()) {
        files.push(absPath);
      }
    }
  };
  walk(root);
  for (const file of files) {
    hash.update(relative(root, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
