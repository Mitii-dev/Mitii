import { SearchService } from './search.service';
import type { SearchQueryDto } from './dto/search-query.dto';

/** HTTP entry points for the Search module, mounted at /search. */
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  async create(req: { body: SearchQueryDto }) {
    return this.searchService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.searchService.findById(req.params.id);
  }

  async findAll() {
    return this.searchService.list();
  }

  async rebuildSearchIndexRoute(req: { params: { id?: string }; body: unknown }) {
    return this.searchService.rebuildSearchIndex(req.params.id as string, req.body as never);
  }

  async searchRoute(req: { params: { id?: string }; body: unknown }) {
    return this.searchService.search(req.params.id as string, req.body as never);
  }
}
