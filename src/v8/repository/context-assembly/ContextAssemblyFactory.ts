import {
  CharacterTokenEstimator,
} from "../chunking";

import {
  CONTEXT_ASSEMBLY_IDS,
} from "./constants";

import {
  ContextAssembler,
} from "./ContextAssembler";

import {
  ContextBlockBuilder,
} from "./ContextBlockBuilder";

import {
  ContextContentLoader,
} from "./ContextContentLoader";

import {
  ContextContentSourceRegistry,
} from "./ContextContentSourceRegistry";

import {
  ContextSecretRedactor,
} from "./ContextSecretRedactor";

import {
  ContextSensitivePathPolicy,
} from "./ContextSensitivePathPolicy";

import {
  ContextTextSanitizer,
} from "./ContextTextSanitizer";

import {
  ContextTextTruncator,
} from "./ContextTextTruncator";

import {
  SelectedPreviewContextSource,
} from "./SelectedPreviewContextSource";

import {
  WorkspaceFileContextSource,
} from "./WorkspaceFileContextSource";

import type {
  ContextAssemblerOptions,
  ContextAssemblyFactoryDependencies,
  ContextAssemblyModule,
} from "./types";

export class ContextAssemblyFactory {
  public readonly id =
    CONTEXT_ASSEMBLY_IDS
      .FACTORY;

  public create(
    dependencies:
      ContextAssemblyFactoryDependencies,
    options:
      ContextAssemblerOptions = {},
  ): ContextAssemblyModule {
    const registry =
      new ContextContentSourceRegistry();

    for (
      const source
      of dependencies
        .additionalSources ??
      []
    ) {
      registry.register(
        source,
      );
    }

    registry.register(
      new SelectedPreviewContextSource(),
    );
    registry.register(
      new WorkspaceFileContextSource({
        fileSystem:
          dependencies
            .fileSystem,
      }),
    );
    registry.freeze();

    const tokenEstimator =
      dependencies
        .tokenEstimator ??
      new CharacterTokenEstimator();
    const loader =
      new ContextContentLoader(
        registry,
      );
    const truncator =
      new ContextTextTruncator(
        tokenEstimator,
      );

    return new ContextAssembler(
      options,
      loader,
      truncator,
      new ContextSensitivePathPolicy(),
      new ContextTextSanitizer(),
      new ContextSecretRedactor(),
      new ContextBlockBuilder(),
    );
  }
}
