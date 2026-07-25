import {
  CODE_INDEX_DEFAULTS,
  CODE_INDEX_IDS,
  CODE_INDEX_LANGUAGE_BY_EXTENSION,
  SQLITE_CODE_INDEX_SQL,
} from "../../constants";

import {
  CodeIndexError,
  throwIfCodeIndexAborted,
} from "../../CodeIndexError";

import {
  CodeIndexIdBuilder,
} from "../../CodeIndexIdBuilder";

import {
  codeIndexFileQueryResultSchema,
  codeIndexImportSchema,
  codeIndexReferenceSchema,
  codeIndexSymbolQuerySchema,
  codeIndexSymbolSchema,
} from "../../schema";

import type {
  CodeIndexContext,
  CodeIndexFile,
  CodeIndexFileQuery,
  CodeIndexFileQueryResult,
  CodeIndexImport,
  CodeIndexReadPort,
  CodeIndexReference,
  CodeIndexSymbol,
  CodeIndexSymbolQuery,
  CodeIndexSymbolQueryResult,
  SqliteCodeIndexAdapterOptions,
  SqliteCodeIndexFileRow,
  SqliteCodeIndexImportRow,
  SqliteCodeIndexReferenceRow,
  SqliteCodeIndexSymbolRow,
  SqliteCodeIndexWatermarkRow,
  SqliteReadPort,
} from "../../types";

import type {
  WorkspaceFileEntry,
} from "../../../workspace";

interface ResolvedRequestedFiles {
  rows: SqliteCodeIndexFileRow[];
  domainIdByDatabaseId: ReadonlyMap<
    number,
    string
  >;
}

interface ReferenceCandidate {
  toFileId: string;
  toSymbolId: string;
}

export class SqliteCodeIndexAdapter
  implements CodeIndexReadPort
{
  public readonly id =
    CODE_INDEX_IDS.SQLITE_ADAPTER;

  private readonly workspace: string;
  private readonly rootId: string;
  private readonly sqlBatchSize: number;

  constructor(
    private readonly database: SqliteReadPort,
    options: SqliteCodeIndexAdapterOptions,
    private readonly idBuilder:
      CodeIndexIdBuilder =
        new CodeIndexIdBuilder(),
  ) {
    this.workspace =
      options.workspace.trim();

    this.rootId =
      options.rootId.trim();

    this.sqlBatchSize =
      options.sqlBatchSize ??
      CODE_INDEX_DEFAULTS.SQLITE_BATCH_SIZE;

    this.validateOptions();
  }

  public async getChangeToken(
    context: CodeIndexContext,
  ): Promise<string> {
    throwIfCodeIndexAborted(
      context.abortSignal,
    );

    try {
      const row = this.database
        .prepare(
          SQLITE_CODE_INDEX_SQL.GET_WATERMARK,
        )
        .get(
          this.workspace,
        ) as
        | SqliteCodeIndexWatermarkRow
        | undefined;

      return [
        context.snapshot.snapshotId,
        this.workspace,
        row?.fileCount ?? 0,
        row?.indexedAtMaximum ?? 0,
        row?.indexedAtSum ?? 0,
        row?.idSum ?? 0,
      ].join(":");
    } catch (error) {
      throw this.createError(
        "Unable to read the SQLite Code Index watermark.",
        "get_change_token",
        error,
      );
    }
  }

  public async getFiles(
    query: CodeIndexFileQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexFileQueryResult> {
    throwIfCodeIndexAborted(
      context.abortSignal,
    );

    this.validatePositiveInteger(
      query.maximumFiles,
      "maximumFiles",
    );

    if (
      query.rootIds &&
      !query.rootIds.includes(this.rootId)
    ) {
      return {
        files: [],
        totalAvailable: 0,
        truncated: false,
      };
    }

    const folderPrefix =
      this.normalizePath(
        query.folderPrefix ?? "",
      );

    const snapshotFiles =
      this.getSnapshotFiles(
        context,
        folderPrefix,
      );

    if (snapshotFiles.length === 0) {
      return {
        files: [],
        totalAvailable: 0,
        truncated: false,
      };
    }

    const snapshotByPath = new Map(
      snapshotFiles.map((entry) => [
        this.normalizePath(
          entry.relativePath,
        ),
        entry,
      ]),
    );

    try {
      const rows =
        await this.loadFileRows(
          [...snapshotByPath.keys()],
          context,
        );

      const files: CodeIndexFile[] = [];

      for (const row of rows) {
        const relativePath =
          this.normalizePath(
            row.relativePath,
          );

        const snapshotEntry =
          snapshotByPath.get(
            relativePath,
          );

        if (!snapshotEntry) {
          continue;
        }

        files.push({
          id:
            this.idBuilder.createFileId({
              rootId: this.rootId,
              relativePath,
            }),

          rootId: this.rootId,
          relativePath,

          ...this.languageProperty(
            relativePath,
          ),

          ...(snapshotEntry.size !==
          undefined
            ? {
                size: snapshotEntry.size,
              }
            : {}),

          ...(snapshotEntry.modifiedAt
            ? {
                modifiedAt:
                  snapshotEntry.modifiedAt,
              }
            : {}),

          ...(snapshotEntry.contentHash
            ? {
                contentHash:
                  snapshotEntry.contentHash,
              }
            : {}),
        });
      }

      files.sort((left, right) =>
        left.relativePath.localeCompare(
          right.relativePath,
        ),
      );

      const totalAvailable =
        files.length;

      return codeIndexFileQueryResultSchema.parse(
        {
          files: files.slice(
            0,
            query.maximumFiles,
          ),

          totalAvailable,

          truncated:
            totalAvailable >
            query.maximumFiles,
        },
      ) as CodeIndexFileQueryResult;
    } catch (error) {
      throw this.normalizeError(
        error,
        "Unable to read indexed files from SQLite.",
        "get_files",
      );
    }
  }

  public async getSymbols(
    query: CodeIndexSymbolQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexSymbolQueryResult> {
    throwIfCodeIndexAborted(
      context.abortSignal,
    );

    const validatedQuery =
      codeIndexSymbolQuerySchema.parse(
        query,
      ) as CodeIndexSymbolQuery;

    const symbolsByFile =
      new Map<
        string,
        CodeIndexSymbol[]
      >();

    for (
      const fileId of
      validatedQuery.fileIds
    ) {
      symbolsByFile.set(
        fileId,
        [],
      );
    }

    const truncatedFileIds =
      new Set<string>();

    try {
      const resolved =
        await this.resolveRequestedFiles(
          validatedQuery.fileIds,
          context,
        );

      const databaseIds =
        resolved.rows.map(
          (row) => row.id,
        );

      for (
        const batch of
        this.createBatches(databaseIds)
      ) {
        throwIfCodeIndexAborted(
          context.abortSignal,
        );

        const rows = this.database
          .prepare(
            `${SQLITE_CODE_INDEX_SQL.GET_SYMBOLS_PREFIX}
             (${this.placeholders(batch.length)})
             ORDER BY s.file_id, s.start_line, s.id`,
          )
          .all(
            this.workspace,
            ...batch,
          ) as SqliteCodeIndexSymbolRow[];

        for (const row of rows) {
          const fileId =
            resolved.domainIdByDatabaseId.get(
              row.fileId,
            );

          if (!fileId) {
            continue;
          }

          const kind =
            row.kind || "symbol";

          if (
            validatedQuery.kinds &&
            validatedQuery.kinds.length >
              0 &&
            !validatedQuery.kinds.includes(
              kind,
            )
          ) {
            continue;
          }

          if (
            validatedQuery.namePrefix &&
            !row.name
              .toLowerCase()
              .startsWith(
                validatedQuery.namePrefix.toLowerCase(),
              )
          ) {
            continue;
          }

          const fileSymbols =
            symbolsByFile.get(fileId);

          if (!fileSymbols) {
            continue;
          }

          if (
            fileSymbols.length >=
            validatedQuery.maximumSymbolsPerFile
          ) {
            truncatedFileIds.add(
              fileId,
            );

            continue;
          }

          const symbol =
            codeIndexSymbolSchema.parse({
              id:
                this.idBuilder.createSymbolId({
                  fileId,
                  kind,
                  name: row.name,
                  ...this.optionalLine(
                    "startLine",
                    row.startLine,
                  ),
                }),

              fileId,
              name: row.name,
              kind,

              ...this.parentSymbolProperty(
                fileId,
                row,
              ),

              ...(row.signature
                ? {
                    signature:
                      row.signature,
                  }
                : {}),

              ...(row.signature?.includes(
                "export",
              )
                ? {
                    exported: true,
                  }
                : {}),

              ...this.optionalLine(
                "startLine",
                row.startLine,
              ),

              ...this.optionalLine(
                "endLine",
                row.endLine,
              ),
            }) as CodeIndexSymbol;

          fileSymbols.push(symbol);
        }
      }

      return {
        symbolsByFile,

        truncatedFileIds:
          [...truncatedFileIds].sort(),
      };
    } catch (error) {
      throw this.normalizeError(
        error,
        "Unable to read symbols from SQLite.",
        "get_symbols",
      );
    }
  }

  public async getImports(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexImport[]> {
    throwIfCodeIndexAborted(
      context.abortSignal,
    );

    const imports:
      CodeIndexImport[] = [];

    const snapshotPaths =
      this.getSnapshotPathSet(context);

    try {
      const resolved =
        await this.resolveRequestedFiles(
          fromFileIds,
          context,
        );

      const databaseIds =
        resolved.rows.map(
          (row) => row.id,
        );

      for (
        const batch of
        this.createBatches(databaseIds)
      ) {
        throwIfCodeIndexAborted(
          context.abortSignal,
        );

        const rows = this.database
          .prepare(
            `${SQLITE_CODE_INDEX_SQL.GET_IMPORTS_PREFIX}
             (${this.placeholders(batch.length)})
             ORDER BY fi.from_file_id, fi.line, fi.to_rel_path`,
          )
          .all(
            this.workspace,
            ...batch,
          ) as SqliteCodeIndexImportRow[];

        for (const row of rows) {
          const fromFileId =
            resolved.domainIdByDatabaseId.get(
              row.fromFileId,
            );

          if (!fromFileId) {
            continue;
          }

          const candidatePath =
            row.targetRelativePath
              ? this.normalizePath(
                  row.targetRelativePath,
                )
              : undefined;

          const targetIsCurrent =
            row.targetFileId !== null &&
            candidatePath !== undefined &&
            snapshotPaths.has(
              candidatePath,
            );

          const item =
            targetIsCurrent &&
            candidatePath
              ? codeIndexImportSchema.parse({
                  resolution:
                    "resolved",

                  fromFileId,

                  toFileId:
                    this.idBuilder.createFileId({
                      rootId:
                        this.rootId,
                      relativePath:
                        candidatePath,
                    }),

                  resolvedRelativePath:
                    candidatePath,

                  specifier:
                    row.specifier,

                  ...this.optionalLine(
                    "line",
                    row.line,
                  ),

                  importedNames: [],
                })
              : codeIndexImportSchema.parse({
                  resolution:
                    "unresolved",

                  fromFileId,

                  specifier:
                    row.specifier,

                  ...this.optionalLine(
                    "line",
                    row.line,
                  ),

                  ...(candidatePath
                    ? {
                        candidateRelativePath:
                          candidatePath,
                      }
                    : {}),

                  importedNames: [],
                });

          imports.push(
            item as CodeIndexImport,
          );
        }
      }

      return this.deduplicateImports(
        imports,
      );
    } catch (error) {
      throw this.normalizeError(
        error,
        "Unable to read imports from SQLite.",
        "get_imports",
      );
    }
  }

  public async getReferences(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<
    readonly CodeIndexReference[]
  > {
    throwIfCodeIndexAborted(
      context.abortSignal,
    );

    const snapshotPaths =
      this.getSnapshotPathSet(context);

    try {
      const resolved =
        await this.resolveRequestedFiles(
          fromFileIds,
          context,
        );

      const groups = new Map<
        string,
        {
          fromFileId: string;
          symbolName: string;
          line?: number;
          candidates: Map<
            string,
            ReferenceCandidate
          >;
        }
      >();

      const databaseIds =
        resolved.rows.map(
          (row) => row.id,
        );

      for (
        const batch of
        this.createBatches(databaseIds)
      ) {
        throwIfCodeIndexAborted(
          context.abortSignal,
        );

        const rows = this.database
          .prepare(
            `${SQLITE_CODE_INDEX_SQL.GET_REFERENCES_PREFIX}
             (${this.placeholders(batch.length)})
             ORDER BY sr.file_id, sr.line, sr.symbol_name, target_symbol.file_id`,
          )
          .all(
            this.workspace,
            ...batch,
          ) as SqliteCodeIndexReferenceRow[];

        for (const row of rows) {
          const fromFileId =
            resolved.domainIdByDatabaseId.get(
              row.fromFileId,
            );

          if (!fromFileId) {
            continue;
          }

          const key = [
            fromFileId,
            row.symbolName,
            row.line,
          ].join("\u0000");

          let group =
            groups.get(key);

          if (!group) {
            group = {
              fromFileId,
              symbolName:
                row.symbolName,
              ...this.optionalLine(
                "line",
                row.line,
              ),
              candidates:
                new Map(),
            };

            groups.set(key, group);
          }

          const targetPath =
            row.targetRelativePath
              ? this.normalizePath(
                  row.targetRelativePath,
                )
              : undefined;

          if (
            !targetPath ||
            !snapshotPaths.has(
              targetPath,
            ) ||
            !row.targetSymbolName ||
            !row.targetSymbolKind
          ) {
            continue;
          }

          const toFileId =
            this.idBuilder.createFileId({
              rootId: this.rootId,
              relativePath:
                targetPath,
            });

          const toSymbolId =
            this.idBuilder.createSymbolId({
              fileId: toFileId,
              kind:
                row.targetSymbolKind,
              name:
                row.targetSymbolName,
              ...this.optionalLine(
                "startLine",
                row.targetSymbolStartLine,
              ),
            });

          group.candidates.set(
            toSymbolId,
            {
              toFileId,
              toSymbolId,
            },
          );
        }
      }

      const references:
        CodeIndexReference[] = [];

      for (const group of groups.values()) {
        const candidates =
          [...group.candidates.values()];

        const onlyCandidate =
          candidates.length === 1
            ? candidates[0]
            : undefined;

        const reference =
          onlyCandidate
            ? {
                fromFileId:
                  group.fromFileId,
                symbolName:
                  group.symbolName,
                ...(group.line !==
                undefined
                  ? {
                      line:
                        group.line,
                    }
                  : {}),
                resolution:
                  "resolved" as const,
                toFileId:
                  onlyCandidate.toFileId,
                toSymbolId:
                  onlyCandidate.toSymbolId,
              }
            : {
                fromFileId:
                  group.fromFileId,
                symbolName:
                  group.symbolName,
                ...(group.line !==
                undefined
                  ? {
                      line:
                        group.line,
                    }
                  : {}),
                resolution:
                  candidates.length > 1
                    ? ("ambiguous" as const)
                    : ("unresolved" as const),
              };

        references.push(
          codeIndexReferenceSchema.parse(
            reference,
          ) as CodeIndexReference,
        );
      }

      return references.sort(
        (left, right) =>
          [
            left.fromFileId,
            left.line ?? 0,
            left.symbolName,
          ]
            .join("\u0000")
            .localeCompare(
              [
                right.fromFileId,
                right.line ?? 0,
                right.symbolName,
              ].join("\u0000"),
            ),
      );
    } catch (error) {
      throw this.normalizeError(
        error,
        "Unable to read references from SQLite.",
        "get_references",
      );
    }
  }

  private async resolveRequestedFiles(
    fileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<ResolvedRequestedFiles> {
    const domainIdByPath =
      new Map<string, string>();

    for (const fileId of fileIds) {
      const identity =
        this.idBuilder.parseFileId(
          fileId,
        );

      if (
        !identity ||
        identity.rootId !==
          this.rootId
      ) {
        continue;
      }

      domainIdByPath.set(
        identity.relativePath,
        fileId,
      );
    }

    const rows =
      await this.loadFileRows(
        [...domainIdByPath.keys()],
        context,
      );

    const domainIdByDatabaseId =
      new Map<number, string>();

    for (const row of rows) {
      const domainId =
        domainIdByPath.get(
          this.normalizePath(
            row.relativePath,
          ),
        );

      if (domainId) {
        domainIdByDatabaseId.set(
          row.id,
          domainId,
        );
      }
    }

    return {
      rows,
      domainIdByDatabaseId,
    };
  }

  private async loadFileRows(
    paths: readonly string[],
    context: CodeIndexContext,
  ): Promise<
    SqliteCodeIndexFileRow[]
  > {
    const rows:
      SqliteCodeIndexFileRow[] = [];

    for (
      const batch of
      this.createBatches(paths)
    ) {
      throwIfCodeIndexAborted(
        context.abortSignal,
      );

      const batchRows = this.database
        .prepare(
          `${SQLITE_CODE_INDEX_SQL.GET_FILES_PREFIX}
           (${this.placeholders(batch.length)})
           ORDER BY rel_path`,
        )
        .all(
          this.workspace,
          ...batch,
        ) as SqliteCodeIndexFileRow[];

      rows.push(...batchRows);
    }

    return rows;
  }

  private getSnapshotFiles(
    context: CodeIndexContext,
    folderPrefix = "",
  ): WorkspaceFileEntry[] {
    return context.snapshot.entries
      .filter(
        (
          entry,
        ): entry is WorkspaceFileEntry =>
          entry.kind === "file" &&
          entry.rootId ===
            this.rootId &&
          this.isWithinFolder(
            entry.relativePath,
            folderPrefix,
          ),
      )
      .sort((left, right) =>
        left.relativePath.localeCompare(
          right.relativePath,
        ),
      );
  }

  private getSnapshotPathSet(
    context: CodeIndexContext,
  ): ReadonlySet<string> {
    return new Set(
      this.getSnapshotFiles(
        context,
      ).map((file) =>
        this.normalizePath(
          file.relativePath,
        ),
      ),
    );
  }

  private parentSymbolProperty(
    fileId: string,
    row: SqliteCodeIndexSymbolRow,
  ): Partial<{
    parentSymbolId: string;
  }> {
    if (
      !row.parentName ||
      !row.parentKind
    ) {
      return {};
    }

    return {
      parentSymbolId:
        this.idBuilder.createSymbolId({
          fileId,
          name: row.parentName,
          kind: row.parentKind,
          ...this.optionalLine(
            "startLine",
            row.parentStartLine,
          ),
        }),
    };
  }

  private optionalLine<
    Key extends string,
  >(
    key: Key,
    value: number | null,
  ): Partial<Record<Key, number>> {
    return value !== null &&
      Number.isSafeInteger(value) &&
      value > 0
      ? ({
          [key]: value,
        } as Partial<
          Record<Key, number>
        >)
      : {};
  }

  private languageProperty(
    relativePath: string,
  ): Partial<{
    language: string;
  }> {
    const extension = relativePath
      .split(".")
      .pop()
      ?.toLowerCase();

    const language = extension
      ? CODE_INDEX_LANGUAGE_BY_EXTENSION[
          extension
        ]
      : undefined;

    return language
      ? {
          language,
        }
      : {};
  }

  private deduplicateImports(
    imports:
      readonly CodeIndexImport[],
  ): CodeIndexImport[] {
    const result = new Map<
      string,
      CodeIndexImport
    >();

    for (const item of imports) {
      const target =
        item.resolution ===
        "resolved"
          ? item.toFileId
          : item.candidateRelativePath ??
            "";

      const key = [
        item.resolution,
        item.fromFileId,
        target,
        item.specifier,
        item.line ?? 0,
      ].join("\u0000");

      if (!result.has(key)) {
        result.set(key, item);
      }
    }

    return [...result.values()];
  }

  private createBatches<T>(
    values: readonly T[],
  ): T[][] {
    const batches: T[][] = [];

    for (
      let index = 0;
      index < values.length;
      index += this.sqlBatchSize
    ) {
      batches.push(
        values.slice(
          index,
          index +
            this.sqlBatchSize,
        ),
      );
    }

    return batches;
  }

  private placeholders(
    count: number,
  ): string {
    if (count <= 0) {
      throw new RangeError(
        "SQL placeholder count must be positive.",
      );
    }

    return new Array(count)
      .fill("?")
      .join(", ");
  }

  private normalizePath(
    value: string,
  ): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }

  private isWithinFolder(
    relativePath: string,
    folderPrefix: string,
  ): boolean {
    if (!folderPrefix) {
      return true;
    }

    const normalizedPath =
      this.normalizePath(
        relativePath,
      );

    return (
      normalizedPath ===
        folderPrefix ||
      normalizedPath.startsWith(
        `${folderPrefix}/`,
      )
    );
  }

  private validateOptions(): void {
    if (!this.workspace) {
      throw new RangeError(
        "workspace must not be empty.",
      );
    }

    if (!this.rootId) {
      throw new RangeError(
        "rootId must not be empty.",
      );
    }

    this.validatePositiveInteger(
      this.sqlBatchSize,
      "sqlBatchSize",
    );
  }

  private validatePositiveInteger(
    value: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer.`,
      );
    }
  }

  private normalizeError(
    error: unknown,
    message: string,
    operation:
      CodeIndexError["operation"],
  ): Error {
    if (
      this.isAbortError(error) ||
      error instanceof CodeIndexError
    ) {
      return error;
    }

    return this.createError(
      message,
      operation,
      error,
    );
  }

  private createError(
    message: string,
    operation:
      CodeIndexError["operation"],
    cause: unknown,
  ): CodeIndexError {
    return new CodeIndexError(
      message,
      {
        operation,
        adapterId: this.id,
        cause,
      },
    );
  }

  private isAbortError(
    error: unknown,
  ): error is Error {
    return (
      error instanceof Error &&
      error.name === "AbortError"
    );
  }
}
