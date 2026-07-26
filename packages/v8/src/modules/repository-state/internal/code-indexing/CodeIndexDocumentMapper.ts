import {
  CODE_INDEXING_SCHEMA_VERSION,
} from "./constants";

import {
  CodeIndexImportResolver,
} from "./CodeIndexImportResolver";

import {
  codeIndexDocumentSchema,
} from "./schema";

import type {
  CodeIndexDocument,
  CodeIndexDocumentMapperInput,
  CodeIndexDocumentImport,
} from "./types";

export class CodeIndexDocumentMapper {
  constructor(
    private readonly importResolver:
      CodeIndexImportResolver =
        new CodeIndexImportResolver(),
  ) {}

  public map(
    input: CodeIndexDocumentMapperInput,
  ): CodeIndexDocument {
    this.validateIdentity(input);

    if (
      input.analysis.status ===
        "failed"
    ) {
      throw new TypeError(
        "Failed SourceAnalysis cannot replace a valid Code Index document.",
      );
    }

    const imports:
      CodeIndexDocumentImport[] =
      input.analysis.imports.map(
        (item) => ({
          ...item,
          ...this.importResolver.resolve({
            importerRootId:
              input.file.rootId,
            importerRelativePath:
              input.file.relativePath,
            specifier:
              item.specifier,
            snapshot:
              input.snapshot,
          }),
        }),
      );

    const document: CodeIndexDocument = {
      schemaVersion:
        CODE_INDEXING_SCHEMA_VERSION,

      file: {
        workspace:
          input.workspace.trim(),
        rootId:
          input.file.rootId,
        relativePath:
          input.file.relativePath,

        ...(input.file.providerPath
          ? {
              providerPath:
                input.file.providerPath,
            }
          : {}),

        ...(input.analysis.language
          ? {
              language:
                input.analysis.language,
            }
          : {}),

        contentHash:
          input.contentHash,
        size:
          input.file.size ?? 0,

        ...(input.file.modifiedAt
          ? {
              modifiedAt:
                input.file.modifiedAt,
            }
          : {}),

        analysisVersion:
          input.analysisVersion,
      },

      sourceAnalysisSchemaVersion:
        input.analysis.schemaVersion,
      sourceId:
        input.analysis.sourceId,

      ...(input.analysis.parserId
        ? {
            parserId:
              input.analysis.parserId,
          }
        : {}),

      quality:
        input.analysis.quality,
      status:
        input.analysis.status,

      symbols:
        input.analysis.symbols.map(
          (item) => ({ ...item }),
        ),
      imports,
      references:
        input.analysis.references.map(
          (item) => ({ ...item }),
        ),

      indexedAt:
        input.indexedAt,
      workspaceSnapshotId:
        input.snapshot.snapshotId,
    };

    return codeIndexDocumentSchema.parse(
      document,
    ) as CodeIndexDocument;
  }

  private validateIdentity(
    input: CodeIndexDocumentMapperInput,
  ): void {
    if (!input.workspace.trim()) {
      throw new RangeError(
        "Code Index workspace cannot be empty.",
      );
    }

    if (
      input.file.kind !== "file"
    ) {
      throw new TypeError(
        "CodeIndexDocumentMapper requires a WorkspaceFileEntry.",
      );
    }

    if (
      input.analysis.rootId !==
        input.file.rootId ||
      input.analysis.relativePath !==
        input.file.relativePath
    ) {
      throw new RangeError(
        "SourceAnalysis identity does not match the workspace file.",
      );
    }

    if (
      !Number.isSafeInteger(
        input.indexedAt,
      ) ||
      input.indexedAt < 0
    ) {
      throw new RangeError(
        "indexedAt must be a non-negative safe integer.",
      );
    }
  }
}
