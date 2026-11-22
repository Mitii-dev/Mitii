import {
  CODE_INDEX_DEFAULTS,
  CODE_INDEX_IDS,
  SQLITE_CODE_INDEX_SQL,
} from "../../constants";

import { throwIfCodeIndexAborted } from "../../CodeIndexError";

import { CodeIndexIdBuilder } from "../../CodeIndexIdBuilder";

import type {
  CodeIndexContext,
  CodeIndexFileQuery,
  CodeIndexFileQueryResult,
  CodeIndexImport,
  CodeIndexReadPort,
  CodeIndexReference,
  CodeIndexSymbolQuery,
  CodeIndexSymbolQueryResult,
  SqliteCodeIndexAdapterOptions,
  SqliteCodeIndexWatermarkRow,
  SqliteReadPort,
} from "../../types";

import {
  createSqliteCodeIndexError,
  validatePositiveInteger,
  type SqliteCodeIndexState,
} from "./sqliteCodeIndexSupport";

import { sqliteGetFiles } from "./sqliteGetFiles";
import { sqliteGetImports } from "./sqliteGetImports";
import { sqliteGetReferences } from "./sqliteGetReferences";
import { sqliteGetSymbols } from "./sqliteGetSymbols";

export class SqliteCodeIndexAdapter
  implements CodeIndexReadPort
{
  public readonly id = CODE_INDEX_IDS.SQLITE_ADAPTER;

  private readonly state: SqliteCodeIndexState;

  constructor(
    database: SqliteReadPort,
    options: SqliteCodeIndexAdapterOptions,
    idBuilder: CodeIndexIdBuilder = new CodeIndexIdBuilder(),
  ) {
    const workspace = options.workspace.trim();
    const rootId = options.rootId.trim();
    const sqlBatchSize =
      options.sqlBatchSize ??
      CODE_INDEX_DEFAULTS.SQLITE_BATCH_SIZE;

    if (!workspace) {
      throw new RangeError("workspace must not be empty.");
    }

    if (!rootId) {
      throw new RangeError("rootId must not be empty.");
    }

    validatePositiveInteger(sqlBatchSize, "sqlBatchSize");

    this.state = {
      adapterId: this.id,
      database,
      workspace,
      rootId,
      sqlBatchSize,
      idBuilder,
    };
  }

  public async getChangeToken(
    context: CodeIndexContext,
  ): Promise<string> {
    throwIfCodeIndexAborted(context.abortSignal);

    try {
      const row = this.state.database
        .prepare(SQLITE_CODE_INDEX_SQL.GET_WATERMARK)
        .get(this.state.workspace) as
        | SqliteCodeIndexWatermarkRow
        | undefined;

      return [
        context.snapshot.snapshotId,
        this.state.workspace,
        row?.fileCount ?? 0,
        row?.indexedAtMaximum ?? 0,
        row?.indexedAtSum ?? 0,
        row?.idSum ?? 0,
      ].join(":");
    } catch (error) {
      throw createSqliteCodeIndexError(
        this.state,
        "Unable to read the SQLite Code Index watermark.",
        "get_change_token",
        error,
      );
    }
  }

  public getFiles(
    query: CodeIndexFileQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexFileQueryResult> {
    return sqliteGetFiles(this.state, query, context);
  }

  public getSymbols(
    query: CodeIndexSymbolQuery,
    context: CodeIndexContext,
  ): Promise<CodeIndexSymbolQueryResult> {
    return sqliteGetSymbols(this.state, query, context);
  }

  public getImports(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexImport[]> {
    return sqliteGetImports(this.state, fromFileIds, context);
  }

  public getReferences(
    fromFileIds: readonly string[],
    context: CodeIndexContext,
  ): Promise<readonly CodeIndexReference[]> {
    return sqliteGetReferences(this.state, fromFileIds, context);
  }
}
