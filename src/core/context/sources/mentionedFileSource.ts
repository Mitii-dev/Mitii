import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as vscode from 'vscode';
import type { ContextItem, ContextQuery, ContextSource } from '../types';
import {
  extractFileMentions,
  expandCamelCaseTerms,
  globPatternsForMention,
} from '../fuzzyFileMatch';

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

    for (const mention of mentions.slice(0, 5)) {
      const relPaths = await findMatchingFiles(this.workspace, mention, searchedPatterns);
      for (const relPath of relPaths) {
        if (seen.has(relPath)) continue;
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

async function findMatchingFiles(
  workspace: string,
  mention: string,
  searchedPatterns: string[]
): Promise<string[]> {
  const patterns = globPatternsForMention(mention);
  const exclude = '**/{node_modules,.git,dist,out,build,.thunder}/**';
  const uris: vscode.Uri[] = [];

  for (const pattern of patterns) {
    searchedPatterns.push(pattern);
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspace, pattern),
      exclude,
      5
    );
    uris.push(...found);
    if (uris.length >= 5) break;
  }

  if (uris.length > 0) {
    return [...new Set(uris.map((u) => vscode.workspace.asRelativePath(u)))];
  }

  // Last resort: scan indexed-like terms from camelCase (e.g. kanban from DinInKanban)
  for (const term of expandCamelCaseTerms(mention)) {
    if (term.length < 4) continue;
    const pattern = `**/*${term}*`;
    searchedPatterns.push(pattern);
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspace, pattern),
      exclude,
      5
    );
    uris.push(...found);
    if (uris.length >= 5) break;
  }

  return [...new Set(uris.map((u) => vscode.workspace.asRelativePath(u)))];
}
