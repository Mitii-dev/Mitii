import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import * as vscode from 'vscode';
import type { ContextItem, ContextQuery, ContextSource } from '../types';
import {
  extractFileMentions,
  expandCamelCaseTerms,
  globPatternsForMention,
} from '../fuzzyFileMatch';
import {
  createWorkspacePattern,
  canUseVscodeFindFiles,
  toWorkspaceRelPath,
  isPathInsideWorkspace,
} from '../../util/paths';
import { createLogger } from '../../telemetry/Logger';

const log = createLogger('MentionedFileSource');
const MAX_FILE_CHARS = 16_000;

export class MentionedFileContextSource implements ContextSource {
  readonly id = 'mentioned-files';

  constructor(private readonly workspace: string) {}

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    const mentions = extractFileMentions(query.text);
    if (mentions.length === 0) return [];

    const items: ContextItem[] = [];
    const seen = new Set<string>();
    const searchedPatterns: string[] = [];
    const fuzzyMentions: string[] = [];

    // Exact paths the user gave verbatim are resolved directly off disk first —
    // synchronous and immune to the findFiles/glob timeout below — so a literal
    // path never gets silently dropped in favor of fuzzy retrieval.
    for (const mention of mentions.slice(0, 5)) {
      if (!mention.includes('/')) {
        fuzzyMentions.push(mention);
        continue;
      }

      const exact = resolveExactMention(this.workspace, mention);
      if (!exact) {
        fuzzyMentions.push(mention);
        continue;
      }

      if (exact.outsideWorkspace) {
        items.push({
          id: `mention-external-${exact.absPath}`,
          source: this.id,
          content:
            `The user referenced a file outside the ${this.workspace} workspace: ${exact.absPath}. ` +
            `Its contents were not loaded automatically. Call read_file with this exact path if you ` +
            `need to inspect it — reading external files requires user approval.`,
          score: 14,
          reason: `External file mentioned (outside workspace): ${exact.absPath}`,
          tokenEstimate: 60,
        });
        continue;
      }

      if (seen.has(exact.relPath)) continue;
      seen.add(exact.relPath);
      try {
        const content = readFileSync(exact.absPath, 'utf-8').slice(0, MAX_FILE_CHARS);
        items.push({
          id: `mention-${exact.relPath}`,
          source: this.id,
          relPath: exact.relPath,
          content,
          score: 14,
          reason: `File mentioned in user message: ${exact.relPath}`,
          tokenEstimate: Math.ceil(content.length / 4),
        });
      } catch {
        // Skip unreadable files.
      }
    }

    for (const mention of fuzzyMentions) {
      const relPaths = await findMatchingFiles(this.workspace, mention, searchedPatterns);
      for (const relPath of relPaths) {
        if (!relPath || relPath === '.' || seen.has(relPath)) continue;
        seen.add(relPath);

        const absPath = join(this.workspace, relPath);
        if (!existsSync(absPath)) continue;

        try {
          const content = readFileSync(absPath, 'utf-8').slice(0, MAX_FILE_CHARS);
          const fuzzy = !relPath.endsWith(mention) && !relPath.includes(mention);
          items.push({
            id: `mention-${relPath}`,
            source: this.id,
            relPath,
            content,
            score: fuzzy ? 13 : 14,
            reason: fuzzy
              ? `Fuzzy file match for "${mention}" → ${relPath}`
              : `File mentioned in user message: ${relPath}`,
            tokenEstimate: Math.ceil(content.length / 4),
          });
        } catch {
          // Skip unreadable files.
        }

        if (items.length >= 5) return items;
      }
    }

    if (items.length === 0) {
      const searched = mentions.slice(0, 5).join(', ');
      const hint = searchedPatterns.length
        ? ` Patterns tried: ${searchedPatterns.slice(0, 6).join(', ')}.`
        : '';
      return [{
        id: 'mention-not-found',
        source: this.id,
        content: `Searched the workspace for: ${searched}. No matching files were found.${hint}`,
        score: 12,
        reason: 'Mentioned files not found in workspace',
        tokenEstimate: 40,
      }];
    }

    return items;
  }
}

/** Runs findFiles for every candidate pattern concurrently so the total wait is
 *  bounded by the slowest single pattern, not the sum of all of them — a sequential
 *  await-per-pattern loop here was blowing past the tier's 800ms budget on repos with
 *  many candidate patterns per mention. */
async function findFilesForPatterns(
  workspace: string,
  patterns: string[],
  exclude: string
): Promise<{ uris: vscode.Uri[]; allFailed: boolean }> {
  const settled = await Promise.allSettled(
    patterns.map((pattern) => {
      try {
        return vscode.workspace.findFiles(createWorkspacePattern(workspace, pattern), exclude, 5);
      } catch (error) {
        return Promise.reject(error);
      }
    })
  );

  const uris: vscode.Uri[] = [];
  let allFailed = settled.length > 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allFailed = false;
      uris.push(...result.value);
    }
  }
  return { uris, allFailed };
}

async function findMatchingFiles(
  workspace: string,
  mention: string,
  searchedPatterns: string[]
): Promise<string[]> {
  const patterns = globPatternsForMention(mention);
  const exclude = '**/{node_modules,.git,dist,out,build,.mitii,.thunder}/**';

  if (!canUseVscodeFindFiles(workspace)) {
    return walkFindOnDisk(workspace, mention, 5);
  }

  searchedPatterns.push(...patterns);
  const first = await findFilesForPatterns(workspace, patterns, exclude);
  if (first.allFailed) {
    log.warn('findFiles failed, using disk fallback', { patterns });
    return walkFindOnDisk(workspace, mention, 5);
  }

  if (first.uris.length > 0) {
    return [...new Set(
      first.uris
        .map((u) => toWorkspaceRelPath(u, workspace))
        .filter((p): p is string => Boolean(p))
    )];
  }

  const camelPatterns = expandCamelCaseTerms(mention)
    .filter((term) => term.length >= 4)
    .map((term) => `**/*${term}*`);

  if (camelPatterns.length === 0) {
    return walkFindOnDisk(workspace, mention, 5);
  }

  searchedPatterns.push(...camelPatterns);
  const second = await findFilesForPatterns(workspace, camelPatterns, exclude);
  if (second.allFailed) {
    return walkFindOnDisk(workspace, mention, 5);
  }

  if (second.uris.length > 0) {
    return [...new Set(
      second.uris
        .map((u) => toWorkspaceRelPath(u, workspace))
        .filter((p): p is string => Boolean(p))
    )];
  }

  return walkFindOnDisk(workspace, mention, 5);
}

/** Resolves a mention that already looks like a path (contains `/`) directly off
 *  disk — no globbing. Returns null when it's not an exact hit, so callers fall
 *  back to fuzzy search. */
function resolveExactMention(
  workspace: string,
  mention: string
): { absPath: string; relPath: string; outsideWorkspace: false } | { absPath: string; outsideWorkspace: true } | null {
  const candidate = isAbsolute(mention) ? mention : join(workspace, mention);

  let isFile: boolean;
  try {
    isFile = existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) return null;

  const absPath = resolve(candidate);
  if (!isPathInsideWorkspace(absPath, workspace)) {
    return { absPath, outsideWorkspace: true };
  }

  const relPath = relative(resolve(workspace), absPath).replace(/\\/g, '/');
  return { absPath, relPath, outsideWorkspace: false };
}

function walkFindOnDisk(workspace: string, needle: string, limit: number): string[] {
  const root = resolve(workspace);
  const results: string[] = [];
  const needleLower = needle.toLowerCase().replace(/^\.\//, '');

  const walk = (dir: string, depth: number): void => {
    if (results.length >= limit || depth > 10) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (['node_modules', '.git', '.mitii', '.thunder', 'dist', 'build', 'out'].includes(entry)) continue;
      const abs = join(dir, entry);
      let rel: string;
      try {
        rel = relative(root, abs).replace(/\\/g, '/');
      } catch {
        continue;
      }
      if (!rel || rel === '.' || rel.startsWith('..')) continue;

      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        walk(abs, depth + 1);
      } else if (
        entry.toLowerCase().includes(needleLower) ||
        rel.toLowerCase().includes(needleLower)
      ) {
        results.push(rel);
        if (results.length >= limit) return;
      }
    }
  };

  walk(root, 0);
  return results;
}
