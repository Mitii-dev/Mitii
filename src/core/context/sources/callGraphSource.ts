import type { ContextItem, ContextQuery, ContextSource } from '../types';
import type { ThunderDb } from '../../indexing/ThunderDb';
import type { WorkspaceLanguageService } from '../../indexing/WorkspaceLanguageService';

const MAX_CANDIDATE_TOKENS = 25;
const MAX_ANCHOR_SYMBOLS = 3;
const MAX_CALLERS_PER_SYMBOL = 8;

interface SymbolRow {
  name: string;
  kind: string;
  start_line: number;
  rel_path: string;
}

/** Precise, on-demand expansion layered on top of the heuristic repo-map: resolves query-mentioned
 * symbol names to their true (re-export-resolved) definition and actual call sites via the
 * persistent language service, rather than the DB's plain name-matching. Query-time only — no
 * full-repo call graph is precomputed, to keep this bounded and avoid the latency this would
 * otherwise add to every retrieval. */
export class CallGraphContextSource implements ContextSource {
  readonly id = 'call-graph';

  constructor(
    private readonly db: ThunderDb,
    private readonly workspace: string,
    private readonly languageService: WorkspaceLanguageService
  ) {}

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    try {
      const tokens = extractCandidateTokens(query.text);
      if (tokens.length === 0) return [];

      const anchors = this.findAnchorSymbols(tokens).slice(0, MAX_ANCHOR_SYMBOLS);
      if (anchors.length === 0) return [];

      const items: ContextItem[] = [];
      for (const anchor of anchors) {
        items.push(...this.buildItemsForAnchor(anchor));
      }
      return items;
    } catch {
      return [];
    }
  }

  private buildItemsForAnchor(anchor: SymbolRow): ContextItem[] {
    const items: ContextItem[] = [];

    const anchorColumn = this.languageService.findColumnForName(anchor.rel_path, anchor.start_line, anchor.name);
    if (anchorColumn === undefined) return items;

    const definitions = this.languageService.getDefinition(anchor.rel_path, anchor.start_line, anchorColumn);
    const primaryDef = definitions[0];

    if (primaryDef) {
      items.push({
        id: `call-graph-def-${primaryDef.relPath}-${primaryDef.startLine}`,
        source: this.id,
        relPath: primaryDef.relPath,
        startLine: primaryDef.startLine,
        endLine: primaryDef.endLine,
        content: `Definition of ${primaryDef.name} (resolved via language service, bypassing re-exports):\n${primaryDef.preview}`,
        score: 9,
        reason: `Call graph: true definition of ${primaryDef.name}`,
        tokenEstimate: Math.ceil(primaryDef.preview.length / 4),
      });
    }

    // Resolve callers from the *true* definition site when available, so a re-exported name
    // still surfaces callers of the real implementation rather than the re-export specifier.
    const defRelPath = primaryDef?.relPath ?? anchor.rel_path;
    const defLine = primaryDef?.startLine ?? anchor.start_line;
    const defName = primaryDef?.name ?? anchor.name;
    const defColumn = primaryDef
      ? this.languageService.findColumnForName(defRelPath, defLine, defName)
      : anchorColumn;
    if (defColumn === undefined) return items;

    const callers = this.languageService.getCallers(defRelPath, defLine, defColumn).slice(0, MAX_CALLERS_PER_SYMBOL);
    if (callers.length > 0) {
      const body = callers
        .map((c) => `${c.relPath}:${c.line}${c.enclosingSymbol ? ` (in ${c.enclosingSymbol})` : ''} — ${c.preview}`)
        .join('\n');
      items.push({
        id: `call-graph-callers-${defRelPath}-${defLine}`,
        source: this.id,
        relPath: defRelPath,
        content: `Callers of ${defName} (${callers.length} found):\n${body}`,
        score: 9,
        reason: `Call graph: callers of ${defName}`,
        tokenEstimate: Math.ceil(body.length / 4),
      });
    }

    return items;
  }

  private findAnchorSymbols(tokens: string[]): SymbolRow[] {
    const placeholders = tokens.map(() => '?').join(',');
    return this.db.raw
      .prepare(
        `SELECT s.name, s.kind, s.start_line, f.rel_path
         FROM symbols s
         JOIN files f ON f.id = s.file_id
         WHERE f.workspace = ? AND s.kind IN ('function', 'method', 'class') AND s.name IN (${placeholders})
         LIMIT 10`
      )
      .all(this.workspace, ...tokens) as SymbolRow[];
  }
}

function extractCandidateTokens(text: string): string[] {
  const matches = text.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const match of matches) {
    if (match.length < 3 || seen.has(match)) continue;
    seen.add(match);
    tokens.push(match);
    if (tokens.length >= MAX_CANDIDATE_TOKENS) break;
  }

  return tokens;
}
