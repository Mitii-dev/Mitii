import {
  TextIndexCoordinator,
} from "../../TextIndexCoordinator";

import {
  TextIndexUpdater,
} from "../../TextIndexUpdater";

import {
  TextSearchService,
} from "../../TextSearchService";

import type {
  SqliteTextIndexAdapterOptions,
  SqliteTextIndexModule,
  TextIndexSqliteDatabasePort,
} from "../../types";

import {
  SqliteTextIndexReader,
} from "./SqliteTextIndexReader";

import {
  SqliteTextIndexWriter,
} from "./SqliteTextIndexWriter";

export class SqliteTextIndexFactory {
  public create(
    database:
      TextIndexSqliteDatabasePort,
    options:
      SqliteTextIndexAdapterOptions = {},
  ): SqliteTextIndexModule {
    const reader =
      new SqliteTextIndexReader(
        database,
        options,
      );

    const writer =
      new SqliteTextIndexWriter(
        database,
        options,
      );

    const updater =
      new TextIndexUpdater(
        writer,
      );

    return {
      reader,
      writer,
      updater,
      coordinator:
        new TextIndexCoordinator(
          updater,
        ),
      search:
        new TextSearchService(
          reader,
        ),
    };
  }
}

