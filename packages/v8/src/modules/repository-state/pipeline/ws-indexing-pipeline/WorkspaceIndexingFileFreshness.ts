import {
  TEXT_INDEX_SCHEMA_VERSION,
} from "../../internal/text-index/constants";

import {
  buildFileResult,
} from "./WorkspaceIndexingFileResultBuilders";

import type {
  WorkspaceIndexingFileProcessorDependencies,
  WorkspaceIndexingFileProcessorInput,
  WorkspaceIndexingFileResult,
} from "./types";

import type {
  SourceAnalysis,
} from "../../internal/source-analysis/types";

import type {
  CodeIndexFileState,
} from "../../internal/code-indexing/types";

import type {
  TextIndexDocumentState,
} from "../../internal/text-index/types";

type FileFreshnessDependency =
  WorkspaceIndexingFileProcessorDependencies[
    "freshness"
  ];

export async function tryBuildUnchangedResultFromCatalog(
  freshness: FileFreshnessDependency,
  input:
    WorkspaceIndexingFileProcessorInput,
): Promise<
  WorkspaceIndexingFileResult |
  undefined
> {
  const file =
    input.selected.file;

  if (
    file.size === undefined ||
    !file.modifiedAt
  ) {
    return undefined;
  }

  const states =
    await readFreshnessStates(
      freshness,
      input,
    );

  if (!states) {
    return undefined;
  }

  const {
    codeState,
    textState,
  } = states;

  if (
    !codeStateIsStatFresh(
      codeState,
      input.selected,
      input.request.analysisVersion,
    ) ||
    !textStateIsFresh(
      textState,
      codeState.contentHash,
      input.request.textPipelineVersion,
    )
  ) {
    return undefined;
  }

  return buildUnchangedResult(
    input,
    codeState,
    textState,
    codeState.contentHash,
  );
}


export async function tryBuildUnchangedResult(
  values: {
    freshness: FileFreshnessDependency;
    input:
      WorkspaceIndexingFileProcessorInput;
    contentHash:
      string;
  },
): Promise<
  WorkspaceIndexingFileResult |
  undefined
> {
  const states =
    await readFreshnessStates(
      values.freshness,
      values.input,
    );

  if (!states) {
    return undefined;
  }

  const {
    request,
    selected,
  } = values.input;
  const {
    codeState,
    textState,
  } = states;

  if (
    !codeStateIsFresh(
      codeState,
      selected,
      values.contentHash,
      request.analysisVersion,
    ) ||
    !textStateIsFresh(
      textState,
      values.contentHash,
      request.textPipelineVersion,
    )
  ) {
    return undefined;
  }

  return buildUnchangedResult(
    values.input,
    codeState,
    textState,
    values.contentHash,
  );
}


async function readFreshnessStates(
  freshness: FileFreshnessDependency,
  input:
    WorkspaceIndexingFileProcessorInput,
): Promise<
  | {
      codeState: CodeIndexFileState;
      textState: TextIndexDocumentState;
    }
  | undefined
> {
  if (!freshness) {
    return undefined;
  }

  const {
    request,
    selected,
  } = input;

  try {
    const [
      codeState,
      textState,
    ] =
      await Promise.all([
        freshness
          .getCodeFileState(
            {
              workspace:
                request.workspace,
              rootId:
                selected.file.rootId,
              relativePath:
                selected.file
                  .relativePath,
            },
            request.abortSignal
              ? {
                  abortSignal:
                    request
                      .abortSignal,
                }
              : {},
          ),
        freshness
          .getTextDocumentState(
            {
              workspace:
                request.workspace,
              rootId:
                selected.file.rootId,
              relativePath:
                selected.file
                  .relativePath,
            },
            request.abortSignal
              ? {
                  abortSignal:
                    request
                      .abortSignal,
                }
              : {},
          ),
      ]);

    if (!codeState || !textState) {
      return undefined;
    }

    return {
      codeState,
      textState,
    };
  } catch {
    return undefined;
  }
}


function buildUnchangedResult(
  input:
    WorkspaceIndexingFileProcessorInput,
  codeState:
    CodeIndexFileState,
  textState:
    TextIndexDocumentState,
  contentHash:
    string,
): WorkspaceIndexingFileResult {
  return buildFileResult({
    selected:
      input.selected,
    status:
      "complete",
    codeIndex:
      {
        status:
          codeState
            .analysisStatus ===
            "unsupported"
            ? "unsupported"
            : "unchanged",
        analysis:
          syntheticAnalysis(
            input.selected,
            codeState,
          ),
        update:
          {
            status:
              "unchanged",
            plan: {
              action:
                "skip",
              reason:
                "unchanged",
            },
          },
      },
    textIndex:
      {
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
        status:
          "unchanged",
        chunkingStatus:
          textState
            .chunkingStatus,
        update:
          {
            status:
              "unchanged",
            plan: {
              action:
                "skip",
              reason:
                "unchanged",
            },
          },
      },
    contentHash,
    warnings:
      [],
  });
}


function codeStateIsStatFresh(
  state:
    CodeIndexFileState,
  selected:
    WorkspaceIndexingFileProcessorInput[
      "selected"
    ],
  analysisVersion:
    string,
): boolean {
  const file =
    selected.file;

  if (
    state.analysisVersion !==
      analysisVersion ||
    !file.modifiedAt ||
    state.modifiedAt !==
      file.modifiedAt ||
    state.size !==
      (file.size ?? 0) ||
    state.providerPath !==
      file.providerPath
  ) {
    return false;
  }

  return (
    !selected.language ||
    selected.language ===
      state.language
  );
}


function codeStateIsFresh(
  state:
    CodeIndexFileState |
    null,
  selected:
    WorkspaceIndexingFileProcessorInput[
      "selected"
    ],
  contentHash:
    string,
  analysisVersion:
    string,
): state is CodeIndexFileState {
  if (
    !state ||
    state.contentHash !==
      contentHash ||
    state.analysisVersion !==
      analysisVersion
  ) {
    return false;
  }

  const file =
    selected.file;

  if (
    state.providerPath !==
      file.providerPath ||
    state.size !==
      (file.size ?? 0) ||
    state.modifiedAt !==
      file.modifiedAt
  ) {
    return false;
  }

  return (
    !selected.language ||
    selected.language ===
      state.language
  );
}


function textStateIsFresh(
  state:
    TextIndexDocumentState |
    null,
  contentHash:
    string,
  pipelineVersion:
    string,
): state is TextIndexDocumentState {
  return Boolean(
    state &&
      state.sourceContentHash ===
        contentHash &&
      state.pipelineVersion ===
        pipelineVersion,
  );
}


function syntheticAnalysis(
  selected:
    WorkspaceIndexingFileProcessorInput[
      "selected"
    ],
  state:
    CodeIndexFileState,
): SourceAnalysis {
  return {
    schemaVersion:
      1,
    sourceId:
      selected.sourceId,
    rootId:
      selected.file.rootId,
    relativePath:
      selected.file
        .relativePath,
    ...(state.language
      ? {
          language:
            state.language,
        }
      : {}),
    languageSource:
      "explicit",
    quality:
      "none",
    status:
      state.analysisStatus,
    symbols:
      [],
    imports:
      [],
    references:
      [],
    warnings:
      [],
  };
}

