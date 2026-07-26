import {
  LanceDbTableManager,
} from "./LanceDbTableManager";

import {
  LanceDbVectorIndexReader,
} from "./LanceDbVectorIndexReader";

import {
  LanceDbVectorIndexWriter,
} from "./LanceDbVectorIndexWriter";

import type {
  LanceDbConnectionPort,
  LanceDbVectorIndexAdapterOptions,
  LanceDbVectorIndexComponents,
} from "../../types";

export class LanceDbVectorIndexFactory {
  public create(
    connection:
      LanceDbConnectionPort,
    options:
      LanceDbVectorIndexAdapterOptions = {},
  ): LanceDbVectorIndexComponents {
    const tableManager =
      new LanceDbTableManager(
        connection,
        options,
      );

    return {
      reader:
        new LanceDbVectorIndexReader(
          tableManager,
        ),
      writer:
        new LanceDbVectorIndexWriter(
          tableManager,
        ),
    };
  }
}
