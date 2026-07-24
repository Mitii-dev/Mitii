import {
  CODE_INDEX_DEFAULTS,
  CODE_INDEX_IDS,
  CODE_INDEX_LANGUAGE_BY_EXTENSION,
  CODE_INDEX_PATTERNS,
  SQLITE_CODE_INDEX_SQL,
} from "../../constants";

import { CodeIndexError, throwIfCodeIndexAborted } from "../../CodeIndexError";

import {
  codeIndexFileQueryResultSchema,
  codeIndexImportSchema,
  codeIndexReferenceSchema,
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
  SqliteCodeIndexAdapterOptions,
  SqliteCodeIndexFileRow,
  SqliteCodeIndexImportRow,
  SqliteCodeIndexReferenceRow,
  SqliteCodeIndexSymbolRow,
  SqliteCodeIndexWatermarkRow,
  SqliteReadPort,
} from "../../types";

import type { WorkspaceFileEntry } from "../../../workspace";

export class SqliteCodeIndexAdapter implements CodeIndexReadPort {
  public readonly id = CODE_INDEX_IDS.SQLITE_ADAPTER;

  private readonly workspace: string;
  private readonly rootId: string;
  private readonly sqlBatchSize: number;

  constructor(
    private readonly database: SqliteReadPort,

    options: SqliteCodeIndexAdapterOptions,
  ) {
    this.workspace = options.workspace.trim();

    this.rootId = options.rootId.trim();

    this.sqlBatchSize =
      options.sqlBatchSize ?? CODE_INDEX_DEFAULTS.SQLITE_BATCH_SIZE;

    this.validateOptions();
  }

  public async getChangeToken(context: CodeIndexContext): Promise<string> {
    throwIfCodeIndexAborted(context.abortSignal);

    try {
      const row = this.database
        .prepare(SQLITE_CODE_INDEX_SQL.GET_WATERMARK)
        .get(this.workspace) as SqliteCodeIndexWatermarkRow | undefined;

      return [
        context.snapshot.snapshotId,
        this.workspace,
        row?.watermark ?? 0,
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
    throwIfCodeIndexAborted(context.abortSignal);

    this.validateMaximumFiles(query.maximumFiles);

    if (query.rootIds && !query.rootIds.includes(this.rootId)) {
      return {
        files: [],
        totalAvailable: 0,
        truncated: false,
      };
    }

    const folderPrefix = this.normalizePath(query.folderPrefix ?? "");

    const snapshotFiles = context.snapshot.entries
      .filter(
        (entry): entry is WorkspaceFileEntry =>
          entry.kind === "file" &&
          entry.rootId === this.rootId &&
          this.isWithinFolder(entry.relativePath, folderPrefix),
      )
      .sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
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
        this.normalizePath(entry.relativePath),
        entry,
      ]),
    );

    try {
      const rows = await this.loadFileRows([...snapshotByPath.keys()], context);

      const files: CodeIndexFile[] = [];

      for (const row of rows) {
        const relativePath = this.normalizePath(row.relativePath);

        const snapshotEntry = snapshotByPath.get(relativePath);

        if (!snapshotEntry) {
          continue;
        }

        files.push({
          id: this.createFileId(row.id),

          rootId: this.rootId,
          relativePath,

          ...this.languageProperty(relativePath),

          ...(snapshotEntry.size !== undefined
            ? {
                size: snapshotEntry.size,
              }
            : {}),

          ...(snapshotEntry.modifiedAt
            ? {
                modifiedAt: snapshotEntry.modifiedAt,
              }
            : {}),

          ...(snapshotEntry.contentHash
            ? {
                contentHash: snapshotEntry.contentHash,
              }
            : {}),
        });
      }

      files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      );

      const totalAvailable = files.length;

      const result = {
        files: files.slice(0, query.maximumFiles),

        totalAvailable,

        truncated: totalAvailable > query.maximumFiles,
      };

      return codeIndexFileQueryResultSchema.parse(
        result,
      ) as CodeIndexFileQueryResult;
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      if (error instanceof CodeIndexError) {
        throw error;
      }

      throw this.createError(
        "Unable to read indexed files from SQLite.",
        "get_files",
        error,
      );
    }
  }

  public async getSymbols(
    query: CodeIndexSymbolQuery,
    context: CodeIndexContext,
  ): Promise<ReadonlyMap<string, readonly CodeIndexSymbol[]>> {
    throwIfCodeIndexAborted(context.abortSignal);

    const result = new Map<string, CodeIndexSymbol[]>();

    for (const fileId of query.fileIds) {
      result.set(fileId, []);
    }

    const databaseIds = this.parseFileIds(query.fileIds);

    try {
      for (const batch of this.createBatches(databaseIds)) {
        throwIfCodeIndexAborted(context.abortSignal);

        const rows = this.database
          .prepare(
            `${SQLITE_CODE_INDEX_SQL.GET_SYMBOLS_PREFIX}
             (${this.placeholders(batch.length)})
             ORDER BY s.file_id, s.start_line, s.id`,
          )
          .all(this.workspace, ...batch) as SqliteCodeIndexSymbolRow[];

        for (const row of rows) {
          const fileId = this.createFileId(row.fileId);

          if (!result.has(fileId)) {
            continue;
          }

          const symbol = codeIndexSymbolSchema.parse({
            id: this.createSymbolId(row.id),

            fileId,

            name: row.name,
            kind: row.kind || "symbol",

            ...(row.signature
              ? {
                  signature: row.signature,
                }
              : {}),

            ...(row.signature?.includes("export")
              ? {
                  exported: true,
                }
              : {}),

            ...(this.validLine(row.startLine)
              ? {
                  startLine: row.startLine,
                }
              : {}),

            ...(this.validLine(row.endLine)
              ? {
                  endLine: row.endLine,
                }
              : {}),
          }) as CodeIndexSymbol;

          result.get(fileId)?.push(symbol);
        }
      }

      return result;
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      throw this.createError(
        "Unable to read symbols from SQLite.",
        "get_symbols",
        error,
      );
    }
  }

  public async getImports(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexImport[]> {
    throwIfCodeIndexAborted(context.abortSignal);

    const databaseIds = this.parseFileIds(fromFileIds);

    const imports: CodeIndexImport[] = [];

    try {
      for (const batch of this.createBatches(databaseIds)) {
        throwIfCodeIndexAborted(context.abortSignal);

        const rows = this.database
          .prepare(
            `${SQLITE_CODE_INDEX_SQL.GET_IMPORTS_PREFIX}
             (${this.placeholders(batch.length)})
             ORDER BY fi.from_file_id, fi.to_rel_path`,
          )
          .all(this.workspace, ...batch) as SqliteCodeIndexImportRow[];

        for (const row of rows) {
          const importEntry = codeIndexImportSchema.parse({
            fromFileId: this.createFileId(row.fromFileId),

            ...(row.targetFileId !== null
              ? {
                  toFileId: this.createFileId(row.targetFileId),
                }
              : {}),

            ...(row.targetRelativePath
              ? {
                  resolvedRelativePath: this.normalizePath(
                    row.targetRelativePath,
                  ),
                }
              : {}),

            importedNames: [],
          }) as CodeIndexImport;

          imports.push(importEntry);
        }
      }

      return this.deduplicateImports(imports);
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      throw this.createError(
        "Unable to read imports from SQLite.",
        "get_imports",
        error,
      );
    }
  }

  public async getReferences(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexReference[]> {
    throwIfCodeIndexAborted(context.abortSignal);

    const databaseIds = this.parseFileIds(fromFileIds);

    const references: CodeIndexReference[] = [];

    try {
      for (const batch of this.createBatches(databaseIds)) {
        throwIfCodeIndexAborted(context.abortSignal);

        const rows = this.database
          .prepare(
            `${SQLITE_CODE_INDEX_SQL.GET_REFERENCES_PREFIX}
             (${this.placeholders(batch.length)})
             ORDER BY sr.file_id, sr.symbol_name, target_symbol.file_id`,
          )
          .all(this.workspace, ...batch) as SqliteCodeIndexReferenceRow[];

        for (const row of rows) {
          const reference = codeIndexReferenceSchema.parse({
            fromFileId: this.createFileId(row.fromFileId),

            symbolName: row.symbolName,

            ...(row.targetFileId !== null
              ? {
                  toFileId: this.createFileId(row.targetFileId),
                }
              : {}),

            ...(row.targetSymbolId !== null
              ? {
                  toSymbolId: this.createSymbolId(row.targetSymbolId),
                }
              : {}),
          }) as CodeIndexReference;

          references.push(reference);
        }
      }

      return this.deduplicateReferences(references);
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      throw this.createError(
        "Unable to read references from SQLite.",
        "get_references",
        error,
      );
    }
  }

  private async loadFileRows(
    paths: readonly string[],
    context: CodeIndexContext,
  ): Promise<SqliteCodeIndexFileRow[]> {
    const rows: SqliteCodeIndexFileRow[] = [];

    for (const batch of this.createBatches(paths)) {
      throwIfCodeIndexAborted(context.abortSignal);

      const batchRows = this.database
        .prepare(
          `${SQLITE_CODE_INDEX_SQL.GET_FILES_PREFIX}
           (${this.placeholders(batch.length)})
           ORDER BY rel_path`,
        )
        .all(this.workspace, ...batch) as SqliteCodeIndexFileRow[];

      rows.push(...batchRows);
    }

    return rows;
  }

  private parseFileIds(fileIds: readonly string[]): number[] {
    const result = new Set<number>();

    const expectedPrefix =
      `${CODE_INDEX_IDS.FILE_PREFIX}:` + `${encodeURIComponent(this.rootId)}:`;

    for (const fileId of fileIds) {
      if (!fileId.startsWith(expectedPrefix)) {
        continue;
      }

      const rawId = fileId.slice(expectedPrefix.length);

      if (!CODE_INDEX_PATTERNS.SAFE_NUMERIC_ID.test(rawId)) {
        continue;
      }

      const databaseId = Number(rawId);

      if (Number.isSafeInteger(databaseId) && databaseId > 0) {
        result.add(databaseId);
      }
    }

    return [...result].sort((left, right) => left - right);
  }

  private createFileId(databaseId: number): string {
    return (
      `${CODE_INDEX_IDS.FILE_PREFIX}:` +
      `${encodeURIComponent(this.rootId)}:` +
      `${databaseId}`
    );
  }

  private createSymbolId(databaseId: number): string {
    return (
      `${CODE_INDEX_IDS.SYMBOL_PREFIX}:` +
      `${encodeURIComponent(this.rootId)}:` +
      `${databaseId}`
    );
  }

  private createBatches<T>(values: readonly T[]): T[][] {
    const batches: T[][] = [];

    for (let index = 0; index < values.length; index += this.sqlBatchSize) {
      batches.push(values.slice(index, index + this.sqlBatchSize));
    }

    return batches;
  }

  private placeholders(count: number): string {
    if (count <= 0) {
      throw new RangeError("SQL placeholder count must be positive.");
    }

    return new Array(count).fill("?").join(", ");
  }

  private languageProperty(relativePath: string): Partial<{
    language: string;
  }> {
    const extension = relativePath.split(".").pop()?.toLowerCase();

    if (!extension) {
      return {};
    }

    const language = CODE_INDEX_LANGUAGE_BY_EXTENSION[extension];

    return language
      ? {
          language,
        }
      : {};
  }

  private deduplicateImports(
    imports: readonly CodeIndexImport[],
  ): CodeIndexImport[] {
    const result = new Map<string, CodeIndexImport>();

    for (const item of imports) {
      const toFileId = "toFileId" in item ? (item.toFileId ?? "") : "";

      const key = [
        item.fromFileId,
        toFileId,
        item.specifier ?? "",
        "resolvedRelativePath" in item ? (item.resolvedRelativePath ?? "") : "",
      ].join("\u0000");

      if (!result.has(key)) {
        result.set(key, item);
      }
    }

    return [...result.values()];
  }

  private deduplicateReferences(
    references: readonly CodeIndexReference[],
  ): CodeIndexReference[] {
    const result = new Map<string, CodeIndexReference>();

    for (const item of references) {
      const key = [
        item.fromFileId,
        item.symbolName,
        item.toFileId ?? "",
        item.toSymbolId ?? "",
      ].join("\u0000");

      if (!result.has(key)) {
        result.set(key, item);
      }
    }

    return [...result.values()];
  }

  private normalizePath(value: string): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/")
      .replace(/\/+$/, "");
  }

  private isWithinFolder(relativePath: string, folderPrefix: string): boolean {
    if (!folderPrefix) {
      return true;
    }

    const path = this.normalizePath(relativePath);

    return path === folderPrefix || path.startsWith(`${folderPrefix}/`);
  }

  private validLine(value: number | null): value is number {
    return value !== null && Number.isSafeInteger(value) && value > 0;
  }

  private validateOptions(): void {
    if (!this.workspace) {
      throw new RangeError("workspace must not be empty.");
    }

    if (!this.rootId) {
      throw new RangeError("rootId must not be empty.");
    }

    if (!Number.isSafeInteger(this.sqlBatchSize) || this.sqlBatchSize <= 0) {
      throw new RangeError("sqlBatchSize must be a positive safe integer.");
    }
  }

  private validateMaximumFiles(maximumFiles: number): void {
    if (!Number.isSafeInteger(maximumFiles) || maximumFiles <= 0) {
      throw new RangeError("maximumFiles must be a positive safe integer.");
    }
  }

  private createError(
    message: string,
    operation: CodeIndexError["operation"],
    cause: unknown,
  ): CodeIndexError {
    return new CodeIndexError(message, {
      operation,
      adapterId: this.id,
      cause,
    });
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
