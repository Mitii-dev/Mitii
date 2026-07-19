import { existsSync } from 'fs';
import { join } from 'path';

export const DEFAULT_WORKSPACE_IGNORE_PATTERNS = [
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  'vendor/',
  'tmp/',
  'logs/',
  '*.lock',
  '*.map',
] as const;

export const DEFAULT_GITIGNORE_PATTERNS = [
  '.mitii/',
  '.mitti/',
] as const;

export const AUTO_INDEX_INITIAL_FILE_LIMIT = 500;
export const AUTO_INDEX_BACKGROUND_DELAY_MS = 8_000;

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
  'webpack.config.js',
  'webpack.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'svelte.config.js',
  'astro.config.mjs',
  'nuxt.config.ts',
  'tailwind.config.js',
  'tailwind.config.ts',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  'biome.json',
  'prettier.config.js',
  '.prettierrc',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
]);

const PRIORITY_ROOT_CANDIDATES = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'src',
  'app',
  'pages',
  'packages',
] as const;

export function priorityDiscoveryRoots(workspace: string): string[] {
  return PRIORITY_ROOT_CANDIDATES.filter((candidate) => existsSync(join(workspace, candidate)));
}

export function sortIndexCandidates<T extends { relPath: string }>(
  files: T[],
  priorityPaths: string[] = []
): T[] {
  return [...files].sort((a, b) => {
    const scoreDelta = priorityScore(a.relPath, priorityPaths) - priorityScore(b.relPath, priorityPaths);
    return scoreDelta || a.relPath.localeCompare(b.relPath);
  });
}

export function priorityScore(relPath: string, priorityPaths: string[] = []): number {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');

  if (priorityPaths.some((path) => matchesPriorityPath(normalized, path))) {
    return 0;
  }

  const basename = normalized.split('/').pop() ?? normalized;
  if (basename === 'package.json') return 10;
  if (CONFIG_FILE_NAMES.has(basename)) return 20;
  if (normalized === 'src' || normalized.startsWith('src/')) return 30;
  if (/^(app|pages|packages)\/[^/]+\/src\//.test(normalized)) return 40;
  if (/\/src\//.test(normalized)) return 50;
  return 100;
}

function matchesPriorityPath(relPath: string, priorityPath: string): boolean {
  const normalized = priorityPath.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!normalized) return false;
  return relPath === normalized || relPath.startsWith(`${normalized}/`);
}
