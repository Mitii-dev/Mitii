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
}
