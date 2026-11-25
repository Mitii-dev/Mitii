import {
  EmbeddingGenerator,
} from "./EmbeddingGenerator";

import {
  EmbeddingSynchronizer,
} from "./EmbeddingSynchronizer";

import type {
  EmbeddingFactoryDependencies,
  EmbeddingFactoryOptions,
  EmbeddingModule,
} from "./types";

export class EmbeddingFactory {
  public create(
    dependencies:
      EmbeddingFactoryDependencies,
    options:
      EmbeddingFactoryOptions = {},
  ): EmbeddingModule {
    const generator =
      new EmbeddingGenerator(
        dependencies.provider,
        {
          ...options.generator,
          ...(dependencies.vectorCache
            ? { vectorCache: dependencies.vectorCache }
            : {}),
        },
      );

    const synchronizer =
      new EmbeddingSynchronizer(
        {
          textIndex:
            dependencies
              .textIndex,
          vectorWriter:
            dependencies
              .vectorWriter,
          generator,
        },
        options.synchronizer,
      );

    return {
      generator,
      synchronizer,
    };
  }
}
