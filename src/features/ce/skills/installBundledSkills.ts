import { createHash, randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { createLogger } from '../../../kernel/telemetry/Logger';
import { resolveBundledSkillsRoot } from './resolveBundledSkillsRoot';
import { parseSkillFrontmatter } from './SkillCatalogService';
import { validateSkillManifest } from './SkillManifestSchema';
import { MAX_SKILL_DESCRIPTION_CHARS } from './skillLimits';

const log = createLogger('BundledSkills');
const MANIFEST_FILE = '.bundled-skills.json';

export interface InstallBundledSkillsResult {
  installed: string[];
  updated: string[];
  preserved: string[];
  skipped: string[];
  removed: string[];
  failed: Array<{ skillId: string; reason: string }>;
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
  const result: InstallBundledSkillsResult = {
    installed: [],
    updated: [],
    preserved: [],
    skipped: [],
    removed: [],
    failed: [],
    bundledRoot: bundledRoot ?? '',
    destinationRoot,
  };

  if (!bundledRoot || !existsSync(bundledRoot)) {
    log.warn('Bundled skills directory missing', { extensionRoot });
    return result;
  }

  mkdirSync(destinationRoot, { recursive: true });
  const manifestPath = join(destinationRoot, MANIFEST_FILE);
  const manifest = readManifest(manifestPath);
  const bundledNames = new Set(listBundledSkillDirs(bundledRoot).map((dir) => basename(dir)));

  for (const skillDir of listBundledSkillDirs(bundledRoot)) {
    const skillName = basename(skillDir);
    const sourceSkillFile = join(skillDir, 'SKILL.md');
    const targetDir = join(destinationRoot, skillName);

    if (!existsSync(sourceSkillFile)) {
      result.failed.push({ skillId: skillName, reason: 'Bundled skill missing SKILL.md' });
      continue;
    }

    try {
      validateInstalledSkill(skillDir);
    } catch (error) {
      result.failed.push({
        skillId: skillName,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

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
      result.preserved.push(skillName);
      result.skipped.push(skillName);
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
      result.preserved.push(skillName);
      result.skipped.push(skillName);
      continue;
    }

    try {
      replaceSkillDirectory(skillDir, targetDir);
      const installedHash = hashDirectory(targetDir);
      manifest.skills[skillName] = { sourceHash, installedHash };
      result.installed.push(skillName);
      if (targetExists) result.updated.push(skillName);
    } catch (error) {
      result.failed.push({
        skillId: skillName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const skillName of Object.keys(manifest.skills)) {
    if (!bundledNames.has(skillName)) {
      result.removed.push(skillName);
    }
  }

  writeManifestAtomic(manifestPath, manifest);

  if (
    result.installed.length > 0 ||
    result.updated.length > 0 ||
    result.skipped.length > 0 ||
    result.failed.length > 0
  ) {
    log.info('Bundled skills install finished', {
      installed: result.installed.length,
      updated: result.updated.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
      destinationRoot,
    });
  }

  return result;
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

function replaceSkillDirectory(sourceDir: string, targetDir: string): void {
  const temporaryDir = `${targetDir}.${process.pid}.${randomUUID()}.tmp`;
  cpSync(sourceDir, temporaryDir, {
    recursive: true,
    force: true,
    filter: (src) => basename(src) !== '.git',
  });
  validateInstalledSkill(temporaryDir);

  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true });
  }
  renameSync(temporaryDir, targetDir);
}

function validateInstalledSkill(skillDir: string): void {
  const skillFile = join(skillDir, 'SKILL.md');
  if (!existsSync(skillFile)) throw new Error('Installed skill missing SKILL.md');
  const manifestPath = join(skillDir, 'skill.json');
  if (!existsSync(manifestPath)) return;
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  const validation = validateSkillManifest(parsed);
  if (!validation.success || !validation.manifest) {
    throw new Error(validation.issues.map((issue) => issue.message).join('; ') || 'Invalid skill manifest');
  }
}

function listBundledSkillDirs(bundledRoot: string): string[] {
  return readdirSync(bundledRoot)
    .map((entry) => join(bundledRoot, entry))
    .filter((absPath) => {
      try {
        const st = statSync(absPath);
        return st.isDirectory() && !st.isSymbolicLink() && existsSync(join(absPath, 'SKILL.md'));
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

function writeManifestAtomic(path: string, manifest: BundledSkillsManifest): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function hashDirectory(root: string): string {
  const hash = createHash('sha256');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === '.git') continue;
      const absPath = join(dir, entry);
      const st = statSync(absPath);
      if (st.isSymbolicLink()) continue;
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
