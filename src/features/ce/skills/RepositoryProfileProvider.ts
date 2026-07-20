import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, extname, join, relative, resolve } from 'path';
import { createHash } from 'crypto';
import type { RepositoryProfile } from './SkillEngine';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
};

const FRAMEWORK_PACKAGES: Record<string, string> = {
  react: 'react',
  next: 'nextjs',
  vue: 'vue',
  svelte: 'svelte',
  '@angular/core': 'angular',
  vite: 'vite',
  docusaurus: 'docusaurus',
  '@docusaurus/core': 'docusaurus',
  express: 'express',
  fastify: 'fastify',
  nestjs: 'nestjs',
  '@nestjs/core': 'nestjs',
};

export interface RepositoryProfileProvider {
  getProfile(scopeRoot?: string): RepositoryProfile;
}

export class WorkspaceRepositoryProfileProvider implements RepositoryProfileProvider {
  private cached = new Map<string, RepositoryProfile>();

  constructor(private readonly workspace: string) {}

  getProfile(scopeRoot?: string): RepositoryProfile {
    const scopeKey = normalizeScopeRoot(scopeRoot);
    const cached = this.cached.get(scopeKey);
    if (cached) return cached;

    const walkRoot = resolveScopedRoot(this.workspace, scopeKey);
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const packageManagers = new Set<string>();
    const paths: string[] = [];
    const projectIds: string[] = [];

    walkWorkspace(walkRoot, (absolutePath) => {
      const relPath = relative(this.workspace, absolutePath).replace(/\\/g, '/');
      paths.push(relPath);
      const language = LANGUAGE_BY_EXTENSION[extname(absolutePath).toLowerCase()];
      if (language) languages.add(language);
      const fileName = basename(absolutePath);
      if (fileName === 'pnpm-lock.yaml') packageManagers.add('pnpm');
      if (fileName === 'yarn.lock') packageManagers.add('yarn');
      if (fileName === 'package-lock.json') packageManagers.add('npm');
      if (fileName === 'bun.lockb' || fileName === 'bun.lock') packageManagers.add('bun');
      if (fileName === 'package.json') {
        const packageJson = readJson(absolutePath);
        if (typeof packageJson?.name === 'string') projectIds.push(packageJson.name);
        const packages = {
          ...asRecord(packageJson?.dependencies),
          ...asRecord(packageJson?.devDependencies),
        };
        for (const [packageName, framework] of Object.entries(FRAMEWORK_PACKAGES)) {
          if (packageName in packages) frameworks.add(framework);
        }
      }
    });

    const repositoryId = basename(this.workspace);
    const versionInput = JSON.stringify({
      repositoryId,
      scopeRoot: scopeKey,
      languages: [...languages].sort(),
      frameworks: [...frameworks].sort(),
      packageManagers: [...packageManagers].sort(),
      projectIds: [...new Set(projectIds)].sort(),
    });
    const profile: RepositoryProfile = {
      version: createHash('sha256').update(versionInput).digest('hex').slice(0, 12),
      repositoryId,
      projectIds: [...new Set(projectIds)],
      languages: [...languages],
      frameworks: [...frameworks],
      packageManagers: [...packageManagers],
      paths: paths.slice(0, 2_000),
    };
    this.cached.set(scopeKey, profile);
    return profile;
  }

  invalidate(): void {
    this.cached.clear();
  }
}

function normalizeScopeRoot(scopeRoot?: string): string {
  if (!scopeRoot || scopeRoot === '.' || scopeRoot === './') return '';
  return scopeRoot.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function resolveScopedRoot(workspace: string, scopeKey: string): string {
  if (!scopeKey) return workspace;
  const workspaceRoot = resolve(workspace);
  const candidate = resolve(workspaceRoot, scopeKey);
  const prefix = workspaceRoot.endsWith('/') || workspaceRoot.endsWith('\\')
    ? workspaceRoot
    : `${workspaceRoot}/`;
  const normalizedCandidate = candidate.replace(/\\/g, '/');
  const normalizedPrefix = prefix.replace(/\\/g, '/');
  if (normalizedCandidate !== workspaceRoot.replace(/\\/g, '/') && !normalizedCandidate.startsWith(normalizedPrefix)) {
    return workspaceRoot;
  }
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  return workspaceRoot;
}

function walkWorkspace(root: string, visit: (path: string) => void): void {
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < 5_000) {
    const current = queue.shift()!;
    if (current.depth > 4) continue;
    let entries: string[];
    try {
      entries = readdirSync(current.path);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (['node_modules', '.git', '.mitii', 'dist', 'build', 'coverage'].includes(name)) continue;
      const absolutePath = join(current.path, name);
      let stats;
      try {
        stats = statSync(absolutePath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) queue.push({ path: absolutePath, depth: current.depth + 1 });
      else {
        visited += 1;
        visit(absolutePath);
      }
    }
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
