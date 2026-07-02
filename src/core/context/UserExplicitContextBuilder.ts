import { existsSync, readFileSync, statSync } from 'fs';
import { join, normalize } from 'path';
import type { ThunderDb } from '../indexing/ThunderDb';
import { detectLanguage } from '../indexing/fileUtils';
import { getExtractor } from '../indexing/SymbolExtractor';
import type { ContextItem } from './types';
import { RepoMapService } from './RepoMapService';
import { extractedToFormatted, formatSymbolsAsAst } from './symbolFormat';
import { estimateTokens } from '../llm/tokenEstimate';
import { extractTsMorphSymbols } from '../indexing/tsMorphScopedAst';

export const EXPLICIT_CONTEXT_TOKEN_LIMIT = 8000;
const MAX_FILE_CHARS = 50_000;
const FOLDER_MAP_CHARS = 4000;

export interface PinnedContextEntry {
  path: string;
  kind: 'file' | 'folder';
  auto?: boolean;
}

export interface ExplicitContextResult {
  items: ContextItem[];
  formatted: string;
  totalTokens: number;
}

export class UserExplicitContextBuilder {
  private readonly tokenBudget: number;

  constructor(
    private readonly db: ThunderDb | undefined,
    private readonly workspace: string,
    tokenBudget = EXPLICIT_CONTEXT_TOKEN_LIMIT
  ) {
    this.tokenBudget = Math.max(1000, Math.floor(tokenBudget));
  }

  build(entries: PinnedContextEntry[]): ExplicitContextResult {
    if (entries.length === 0) {
      return { items: [], formatted: '', totalTokens: 0 };
    }

    const repoMap = this.db?.isOpen()
      ? new RepoMapService(this.db, this.workspace)
      : undefined;

    const items: ContextItem[] = [];
    const xmlParts: string[] = [];
    let usedTokens = 0;
    const seen = new Set<string>();

    for (const entry of entries.slice(0, 12)) {
      const relPath = normalizeRelPath(entry.path);
      if (!relPath || seen.has(`${entry.kind}:${relPath}`)) continue;
      seen.add(`${entry.kind}:${relPath}`);

      if (entry.kind === 'folder') {
        const folderResult = this.buildFolderMap(relPath, repoMap, usedTokens);
        if (!folderResult) continue;
        usedTokens += folderResult.tokens;
        items.push(folderResult.item);
        xmlParts.push(folderResult.xml);
        continue;
      }

      const fileResult = this.buildFile(relPath, usedTokens);
      if (!fileResult) continue;
      usedTokens += fileResult.tokens;
      items.push(fileResult.item);
      xmlParts.push(fileResult.xml);
    }

    if (xmlParts.length === 0) {
      return { items: [], formatted: '', totalTokens: 0 };
    }

    const systemNote =
      'The user explicitly requested you focus on the above files/folders to solve the current task. ' +
      'Prioritize modifying these paths before exploring the wider repo-map.';

    const formatted = [
      '<user_explicit_context>',
      ...xmlParts,
      '  <system_note>',
      `    ${systemNote}`,
      '  </system_note>',
      '</user_explicit_context>',
    ].join('\n');

    return {
      items,
      formatted,
      totalTokens: estimateTokens(formatted),
    };
  }

  private buildFile(
    relPath: string,
    usedTokens: number
  ): { item: ContextItem; xml: string; tokens: number } | undefined {
    const absPath = join(this.workspace, relPath);
    if (!existsSync(absPath) || !statSync(absPath).isFile()) return undefined;

    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8').slice(0, MAX_FILE_CHARS);
    } catch {
      return undefined;
    }

    const remaining = this.tokenBudget - usedTokens;
    const fullTokens = estimateTokens(content);

    if (fullTokens <= remaining && fullTokens <= this.tokenBudget) {
      const xml = `  <file path="${relPath}">\n${indentBlock(content)}\n  </file>`;
      return {
        item: {
          id: `explicit-file-${relPath}`,
          source: 'user-explicit',
          relPath,
          content,
          score: 20,
          reason: `User-pinned file: ${relPath}`,
          tokenEstimate: fullTokens,
        },
        xml,
        tokens: fullTokens,
      };
    }

    const astContent = this.buildScopedAst(relPath, content);
    const astTokens = estimateTokens(astContent);
    if (usedTokens > 0 && astTokens > remaining) return undefined;
    const xml = `  <file path="${relPath}" representation="scoped-ast">\n${indentBlock(astContent)}\n  </file>`;
    return {
      item: {
        id: `explicit-ast-${relPath}`,
        source: 'user-explicit',
        relPath,
        content: astContent,
        score: 19,
        reason: `User-pinned file (scoped AST): ${relPath}`,
        tokenEstimate: astTokens,
      },
      xml,
      tokens: astTokens,
    };
  }

  private buildFolderMap(
    relPath: string,
    repoMap: RepoMapService | undefined,
    usedTokens: number
  ): { item: ContextItem; xml: string; tokens: number } | undefined {
    const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
    const absPath = join(this.workspace, relPath);
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) return undefined;

    const mapContent = repoMap
      ? repoMap.build({
          folderPrefix: prefix,
          maxChars: FOLDER_MAP_CHARS,
        })
      : `(folder ${relPath} — index workspace for scoped repo map)`;

    const tokens = estimateTokens(mapContent);
    if (usedTokens + tokens > this.tokenBudget) return undefined;

    const xml = `  <folder_map path="${relPath}">\n${indentBlock(mapContent)}\n  </folder_map>`;
    return {
      item: {
        id: `explicit-folder-${relPath}`,
        source: 'user-explicit',
        relPath,
        content: mapContent,
        score: 18,
        reason: `User-pinned folder map: ${relPath}`,
        tokenEstimate: tokens,
      },
      xml,
      tokens,
    };
  }

  private buildScopedAst(relPath: string, content: string): string {
    const indexed = this.getIndexedSymbols(relPath);
    if (indexed.length > 0) {
      return formatSymbolsAsAst(relPath, indexed);
    }

    const lang = detectLanguage(relPath);
    if (lang === 'typescript' || lang === 'javascript') {
      const morphSymbols = extractTsMorphSymbols(relPath, content);
      if (morphSymbols.length > 0) {
        return formatSymbolsAsAst(relPath, morphSymbols);
      }
    }

    const extractor = lang ? getExtractor(lang) : undefined;
    const symbols = extractor?.extract(content) ?? [];
    return formatSymbolsAsAst(relPath, extractedToFormatted(symbols));
  }

  private getIndexedSymbols(relPath: string): Array<{
    name: string;
    kind: string;
    exported?: boolean;
    signature?: string | null;
  }> {
    if (!this.db?.isOpen()) return [];

    const row = this.db.raw
      .prepare('SELECT id FROM files WHERE workspace = ? AND rel_path = ?')
      .get(this.workspace, relPath) as { id: number } | undefined;
    if (!row) return [];

    const symbols = this.db.raw
      .prepare(
        'SELECT name, kind, signature FROM symbols WHERE file_id = ? ORDER BY start_line LIMIT 40'
      )
      .all(row.id) as Array<{ name: string; kind: string; signature: string | null }>;

    return symbols.map((s) => ({
      name: s.name,
      kind: s.kind,
      exported: s.signature?.includes('export') ?? false,
      signature: s.signature,
    }));
  }
}

function normalizeRelPath(path: string): string {
  return normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
}

function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
