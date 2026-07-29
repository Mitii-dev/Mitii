import type {
  EmbeddingProvider,
} from "../internal/embedding/types";
import {
  SqliteTextIndexFactory,
} from "../internal/text-index/adapters/sqlite/SqliteTextIndexFactory";
import type {
  TextIndexReadPort,
  TextIndexSqliteDatabasePort,
} from "../internal/text-index/types";
import {
  LanceDbVectorIndexFactory,
} from "../internal/vector-index/adapters/lancedb/LanceDbVectorIndexFactory";
import {
  VectorIndexFactory,
} from "../internal/vector-index/VectorIndexFactory";
import type {
  LanceDbConnectionPort,
  LanceDbVectorIndexAdapterOptions,
  VectorIndexReadPort,
} from "../internal/vector-index/types";

export interface WorkspaceRetrievalRuntimeVectorOptions {
  embeddingProvider: EmbeddingProvider;
  lanceConnection: LanceDbConnectionPort;
  lance?: LanceDbVectorIndexAdapterOptions;
}

export interface CreateWorkspaceRetrievalRuntimeOptions {
  textIndexDatabase: TextIndexSqliteDatabasePort;
  vector?: WorkspaceRetrievalRuntimeVectorOptions;
}

/**
 * Read-only composition for hybrid retrieval.
 *
 * Unlike {@link createWorkspaceIndexRuntime}, this does not migrate indexes,
 * open a write pipeline, or attach an embedding synchronizer.
 */
export interface WorkspaceRetrievalRuntime {
  textIndex: TextIndexReadPort;
  vectorIndex?: VectorIndexReadPort;
  embeddingProvider?: EmbeddingProvider;
  close(): Promise<void>;
}

export function createWorkspaceRetrievalRuntime(
  options: CreateWorkspaceRetrievalRuntimeOptions,
): WorkspaceRetrievalRuntime {
  const textIndex = new SqliteTextIndexFactory()
    .create(options.textIndexDatabase)
    .reader;

  if (!options.vector) {
    return {
      textIndex,
      close: async () => {},
    };
  }

  const lanceVectorIndex = new LanceDbVectorIndexFactory().create(
    options.vector.lanceConnection,
    options.vector.lance,
  );
  const vectorIndex = new VectorIndexFactory().create(lanceVectorIndex);

  return {
    textIndex,
    vectorIndex: vectorIndex.reader,
    embeddingProvider: options.vector.embeddingProvider,
    close: async () => {},
  };
}
