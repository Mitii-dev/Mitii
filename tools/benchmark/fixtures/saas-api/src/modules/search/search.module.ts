import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchRepository } from './search.repository';

/** Wires the Search controller/service/repository together for the app module. */
export class SearchModule {
  readonly repository = new SearchRepository();
  readonly service = new SearchService(this.repository);
  readonly controller = new SearchController(this.service);
}
