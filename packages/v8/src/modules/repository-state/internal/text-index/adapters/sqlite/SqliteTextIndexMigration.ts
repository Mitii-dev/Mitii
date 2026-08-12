import {
  expandFtsText,
} from "../../../../codeIdentifiers";

import {
  TEXT_INDEX_IDS,
  TEXT_INDEX_SCHEMA_VERSION,
  TEXT_INDEX_SQL,
} from "../../constants";

import {
  TextIndexError,
} from "../../TextIndexError";

import type {
  TextIndexMigrationResult,
  TextIndexSqliteDatabasePort,
} from "../../types";

interface MigrationNeededRow {
  value: number;
}

export class SqliteTextIndexMigration {
  public async migrate(
    database:
      TextIndexSqliteDatabasePort,
  ): Promise<TextIndexMigrationResult> {
    try {
      const transaction = database.transaction(() => {
        database.exec(
          TEXT_INDEX_SQL
            .CREATE_SCHEMA,
        );

        if (
          this.needsIdentifierFtsMigration(
            database,
          )
        ) {
          database.exec(
            TEXT_INDEX_SQL
              .RECREATE_IDENTIFIER_FTS,
          );
          this.rebuildIdentifierFts(
            database,
          );
        }
      }) as unknown;

      if (typeof transaction === "function") {
        transaction();
      }

      return {
        schemaVersion:
          TEXT_INDEX_SCHEMA_VERSION,
      };
    } catch (error) {
      throw new TextIndexError(
        "Unable to migrate the SQLite Text Index schema.",
        {
          operation: "migrate",
          adapterId:
            TEXT_INDEX_IDS
              .SQLITE_MIGRATION,
          cause: error,
        },
      );
    }
  }

  private needsIdentifierFtsMigration(
    database:
      TextIndexSqliteDatabasePort,
  ): boolean {
    const staleMetadata =
      database
        .prepare(
          `
            SELECT COUNT(*) AS value
            FROM text_index_metadata
            WHERE schema_version < ?
          `,
        )
        .get(
          TEXT_INDEX_SCHEMA_VERSION,
        ) as MigrationNeededRow;

    if (staleMetadata.value > 0) {
      return true;
    }

    const staleTriggers =
      database
        .prepare(
          `
            SELECT COUNT(*) AS value
            FROM sqlite_schema
            WHERE type = 'trigger'
              AND name IN (
                'text_index_chunks_after_insert',
                'text_index_chunks_before_delete',
                'text_index_chunks_after_update'
              )
          `,
        )
        .get() as MigrationNeededRow;

    return staleTriggers.value > 0;
  }

  private rebuildIdentifierFts(
    database:
      TextIndexSqliteDatabasePort,
  ): void {
    const rows =
      database
        .prepare(
          TEXT_INDEX_SQL
            .LIST_CHUNKS_FOR_FTS,
        )
        .all() as Array<{
        rowid: number | bigint;
        id: string;
        workspace: string;
        rootId: string;
        relativePath: string;
        kind: string;
        title: string;
        content: string;
      }>;

    const insert =
      database.prepare(
        TEXT_INDEX_SQL
          .INSERT_CHUNK_FTS_DIRECT,
      );

    for (const row of rows) {
      insert.run(
        row.rowid,
        row.id,
        row.workspace,
        row.rootId,
        row.relativePath,
        row.kind,
        expandFtsText(row.title),
        expandFtsText(
          [
            row.relativePath,
            row.title,
            row.content,
          ].join(" "),
        ),
      );
    }
  }
}
