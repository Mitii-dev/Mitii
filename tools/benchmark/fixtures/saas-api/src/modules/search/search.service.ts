import { SearchRepository } from './search.repository';
import type { SearchQueryDto } from './dto/search-query.dto';
import type { IndexDocumentDto } from './dto/index-document.dto';

export interface SearchDocument {
  id: string;
  entityType: string;
  entityId: string;
  text: string;
}

export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  async create(dto: SearchQueryDto): Promise<SearchDocument> {
    return this.repository.insert(dto as Partial<SearchDocument>);
  }

  async findById(id: string): Promise<SearchDocument> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`SearchDocument ${id} not found`);
    return row;
  }

  async list(): Promise<SearchDocument[]> {
    return this.repository.findAll();
  }

  /**
   * Rebuilds the full-text search index for one entity type from scratch, used after a schema change or index corruption.
   */
  async rebuildSearchIndex(entityType: string): Promise<number> {
    const rows = await this.repository.streamAllForType(entityType);
    return this.repository.reindexAll(entityType, rows);
  }

  /**
   * Runs a ranked full-text search query scoped to an optional entity type, returning results ordered by relevance score.
   */
  async search(dto: SearchQueryDto): Promise<SearchDocument[]> {
    return this.repository.fullTextSearch(dto.query, dto.entityType);
  }
}
