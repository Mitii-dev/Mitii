import {
  VectorSearchService,
} from "./VectorSearchService";

import type {
  VectorIndexFactoryDependencies,
  VectorIndexModule,
} from "./types";

export class VectorIndexFactory {
  public create(
    dependencies:
      VectorIndexFactoryDependencies,
  ): VectorIndexModule {
    const searchService =
      new VectorSearchService(
        dependencies.reader,
      );

    return {
      reader:
        dependencies.reader,
      writer:
        dependencies.writer,
      search:
        (input) =>
          searchService
            .search(input),
    };
  }
}
