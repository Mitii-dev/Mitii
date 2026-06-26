import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ContextItem, ContextQuery, ContextSource } from '../types';
import type { ThunderDb } from '../../indexing/ThunderDb';
import { extractIndexedSearchTerms } from '../fuzzyFileMatch';

const MAX_FILE_CHARS = 16_000;

export class IndexedFileSearchContextSource implements ContextSource {
  readonly id = 'indexed-file-search';

  constructor(
    private readonly db: ThunderDb,
    private readonly workspace: string
  ) {}

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    const terms = extractIndexedSearchTerms(query.text);
    if (terms.length === 0) return [];

    const paths = new Set<string>();
    const stmt = this.db.raw.prepare(`
      SELECT rel_path FROM files
      WHERE workspace = ? AND lower(rel_path) LIKE ?
      ORDER BY rel_path
      LIMIT 8
    `);

    for (const term of terms.slice(0, 8)) {
      const rows = stmt.all(this.workspace, `%${term.toLowerCase()}%`) as Array<{ rel_path: string }>;
      for (const row of rows) {
        paths.add(row.rel_path);
        if (paths.size >= 5) break;
      }
      if (paths.size >= 5) break;
    }

    const items: ContextItem[] = [];
    for (const relPath of paths) {
      const absPath = join(this.workspace, relPath);
      if (!existsSync(absPath)) continue;

      try {
        const content = readFileSync(absPath, 'utf-8').slice(0, MAX_FILE_CHARS);
        items.push({
          id: `indexed-search-${relPath}`,
          source: this.id,
          relPath,
          content,
          score: 11,
          reason: `Indexed path match for query terms: ${terms.slice(0, 4).join(', ')}`,
          tokenEstimate: Math.ceil(content.length / 4),
        });
      } catch {
        // Skip unreadable files.
      }
    }

    return items;
  }
}
