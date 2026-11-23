import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { initModeCatalog } from '@mitii/host';

import { resolveMitiiCliPaths } from './cliPaths.js';

export const MITII_GITIGNORE_PATTERNS = [
  '.mitii/',
  '.env',
  '.env.local',
] as const;

export interface EnsureMitiiWorkspaceResult {
  mitiiDir: string;
  createdDirs: string[];
  modesCatalog: { path: string; created: boolean };
}

/** Create the standard `.mitii` layout used by the CLI. */
export function ensureMitiiWorkspace(cwd: string): EnsureMitiiWorkspaceResult {
  const paths = resolveMitiiCliPaths(cwd);
  const createdDirs: string[] = [];
  const dirs = [
    join(paths.cwd, '.mitii'),
    paths.logsDirSource === 'workspace'
      ? paths.logsDir
      : join(paths.cwd, '.mitii', 'logs'),
    paths.agentsDir,
    paths.recipesDir,
    paths.skillsDir,
    paths.checkpointsDir,
    paths.memoryDir,
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      createdDirs.push(dir);
    }
  }
  const modesCatalog = initModeCatalog(paths.cwd);
  return {
    mitiiDir: join(paths.cwd, '.mitii'),
    createdDirs,
    modesCatalog,
  };
}

export interface GitignoreUpdateResult {
  path: string;
  added: string[];
  skipped: string[];
  created: boolean;
}

/**
 * Append missing Mitii ignore patterns to `.gitignore`.
 * Returns which patterns were added.
 */
export function ensureMitiiGitignore(
  cwd: string,
  patterns: readonly string[] = MITII_GITIGNORE_PATTERNS,
): GitignoreUpdateResult {
  const root = resolve(cwd);
  const path = join(root, '.gitignore');
  const created = !existsSync(path);
  let content = created ? '' : readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  const added: string[] = [];
  const skipped: string[] = [];

  for (const pattern of patterns) {
    const bare = pattern.replace(/\/$/, '');
    const already = lines.some(
      (line) =>
        line === pattern ||
        line === bare ||
        line === `${bare}/` ||
        line === `/${bare}` ||
        line === `/${bare}/`,
    );
    if (already) {
      skipped.push(pattern);
      continue;
    }
    added.push(pattern);
  }

  if (added.length > 0) {
    if (content.length > 0 && !content.endsWith('\n')) {
      content += '\n';
    }
    const block = ['', '# Mitii', ...added, ''].join('\n');
    content = created ? ['# Mitii', ...added, ''].join('\n') : content + block;
    writeFileSync(path, content, 'utf8');
  }

  return { path, added, skipped, created };
}

export interface AgentsMarkdownResult {
  path: string;
  created: boolean;
}

/** Create a minimal AGENTS.md project brief when missing. */
export function ensureAgentsMarkdown(cwd: string): AgentsMarkdownResult {
  const path = join(resolve(cwd), 'AGENTS.md');
  if (existsSync(path)) {
    return { path, created: false };
  }
  const body = `# Project brief

Describe architecture, conventions, and constraints Mitii should follow in this repository.

## Stack

- (languages, frameworks, package managers)

## Conventions

- (naming, testing, PR expectations)

## Do not

- (sensitive paths, forbidden refactors)
`;
  writeFileSync(path, body, 'utf8');
  return { path, created: true };
}

export function detectGitWorkspace(cwd: string): {
  present: boolean;
  rootHint: string;
} {
  const root = resolve(cwd);
  return {
    present: existsSync(join(root, '.git')),
    rootHint: root,
  };
}
