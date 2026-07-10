import type { SearchDocument } from './search.service';

/** In-memory-style persistence layer for SearchDocument rows. Swap for a real DB client in production. */
export class SearchRepository {
  private rows = new Map<string, SearchDocument>();

  async insert(data: Partial<SearchDocument>): Promise<SearchDocument> {
    const id = `search_${this.rows.size + 1}`;
    const row = { id, ...data } as SearchDocument;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<SearchDocument | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<SearchDocument[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<SearchDocument>): Promise<SearchDocument> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`SearchDocument ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
