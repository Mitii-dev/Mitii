import {
  CharacterTokenEstimator,
} from "./CharacterTokenEstimator";

import {
  ChunkNormalizer,
} from "./ChunkNormalizer";

import {
  ChunkingService,
} from "./ChunkingService";

import {
  CodeChunker,
} from "./strategies/CodeChunker";

import {
  ChunkingStrategyRegistry,
} from "./strategies/ChunkingStrategyRegistry";

import {
  MarkdownChunker,
} from "./strategies/MarkdownChunker";

import {
  TextChunker,
} from "./strategies/TextChunker";

import type {
  ChunkingFactoryDependencies,
  ChunkingFactoryOptions,
  ChunkingServicePort,
} from "./types";

export class ChunkingFactory {
  public create(
    dependencies:
      ChunkingFactoryDependencies,
    options:
      ChunkingFactoryOptions = {},
  ): ChunkingServicePort {
    const tokenEstimator =
      dependencies
        .tokenEstimator ??
      new CharacterTokenEstimator();

    const registry =
      new ChunkingStrategyRegistry();

    registry.register(
      new CodeChunker(),
    );

    registry.register(
      new MarkdownChunker(),
    );

    registry.register(
      new TextChunker(),
    );

    for (
      const strategy of
        dependencies
          .additionalStrategies ??
        []
    ) {
      registry.register(
        strategy,
      );
    }

    registry.freeze();

    const normalizer =
      new ChunkNormalizer(
        dependencies.hasher,
        tokenEstimator,
      );

    return new ChunkingService(
      {
        registry,
        normalizer,
        hasher:
          dependencies.hasher,
      },
      options.defaultOptions,
    );
  }
}

