import {
  CODE_INDEXING_COLUMNS,
  CODE_INDEXING_MIGRATION_SQL,
  CODE_INDEXING_SCHEMA_VERSION,
  CODE_INDEXING_TABLES,
} from "../../constants";

import {
  CodeIndexWriteError,
} from "../../CodeIndexWriteError";

import type {
  CodeIndexMigrationResult,
  SqliteCodeIndexColumnRow,
  SqliteCodeIndexDatabasePort,
} from "../../types";

export class SqliteCodeIndexMigration {
  public async migrate(
    database: SqliteCodeIndexDatabasePort,
  ): Promise<CodeIndexMigrationResult> {
    const addedColumns:
      string[] = [];

    try {
      database.transaction(() => {
        database.exec(
          CODE_INDEXING_MIGRATION_SQL
            .CREATE_BASE_SCHEMA,
        );

        this.ensureColumns(
          database,
          CODE_INDEXING_TABLES.FILES,
          CODE_INDEXING_COLUMNS.FILES,
          CODE_INDEXING_MIGRATION_SQL
            .FILE_COLUMN_ALTERS,
          addedColumns,
        );

        this.ensureColumns(
          database,
          CODE_INDEXING_TABLES.SYMBOLS,
          CODE_INDEXING_COLUMNS.SYMBOLS,
          CODE_INDEXING_MIGRATION_SQL
            .SYMBOL_COLUMN_ALTERS,
          addedColumns,
        );

        this.ensureColumns(
          database,
          CODE_INDEXING_TABLES.IMPORTS,
          CODE_INDEXING_COLUMNS.IMPORTS,
          CODE_INDEXING_MIGRATION_SQL
            .IMPORT_COLUMN_ALTERS,
          addedColumns,
        );

        this.ensureColumns(
          database,
          CODE_INDEXING_TABLES.REFERENCES,
          CODE_INDEXING_COLUMNS.REFERENCES,
          CODE_INDEXING_MIGRATION_SQL
            .REFERENCE_COLUMN_ALTERS,
          addedColumns,
        );
      });

      return {
        schemaVersion:
          CODE_INDEXING_SCHEMA_VERSION,
        addedColumns:
          addedColumns.sort(),
      };
    } catch (error) {
      throw new CodeIndexWriteError(
        "Unable to migrate the SQLite Code Index schema.",
        {
          operation: "migrate",
          adapterId:
            "sqlite-code-index-migration",
          cause: error,
        },
      );
    }
  }

  private ensureColumns(
    database: SqliteCodeIndexDatabasePort,
    table: string,
    columns: Readonly<
      Record<string, string>
    >,
    alters: Readonly<
      Record<string, string>
    >,
    addedColumns: string[],
  ): void {
    const rows = database
      .prepare(
        `PRAGMA table_info(${table})`,
      )
      .all() as SqliteCodeIndexColumnRow[];

    const existing = new Set(
      rows.map((row) => row.name),
    );

    for (
      const columnName of
      Object.values(columns)
    ) {
      if (existing.has(columnName)) {
        continue;
      }

      const alter = alters[columnName];

      if (!alter) {
        throw new Error(
          `No migration is registered for ${table}.${columnName}.`,
        );
      }

      database.exec(alter);
      addedColumns.push(
        `${table}.${columnName}`,
      );
    }
  }
}
