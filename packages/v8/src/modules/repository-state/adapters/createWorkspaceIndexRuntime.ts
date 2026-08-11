import {
  EmbeddingFactory,
} from "../internal/embedding/EmbeddingFactory";
import type {
  EmbeddingFactoryOptions,
  EmbeddingProvider,
} from "../internal/embedding/types";
import type {
  FileSystemPort,
} from "../internal/shared/filesystem/types";
import type {
  SqliteTextIndexModule,
  TextIndexSqliteDatabasePort,
} from "../internal/text-index/types";
import type {
  SqliteCodeIndexDatabasePort,
} from "../internal/code-indexing/types";
import type {
  WorkspaceScanner,
} from "../internal/workspace/WorkspaceScanner";
import type {
  WorkspaceIgnorePolicyOptions,
} from "../internal/workspace/types";
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
import type {
  WorkspaceIndexingFilePolicyPort,
} from "../pipeline/ws-indexing-pipeline/types";
import type {
  WorkspaceIndexingPipeline,
} from "../pipeline/ws-indexing-pipeline/WorkspaceIndexingPipeline";
import type {
  TreeSitterRuntimePort,
} from "../internal/source-analysis/types";
import {
  WorkspaceIndexingAdapterFactory,
} from "./WorkspaceIndexingAdapterFactory";

export interface WorkspaceIndexRuntimeVectorOptions {
  embeddingProvider: EmbeddingProvider;
  lanceConnection: LanceDbConnectionPort;
  lance?: LanceDbVectorIndexAdapterOptions;
  embedding?: EmbeddingFactoryOptions;
}

export interface CreateWorkspaceIndexRuntimeOptions {
  codeIndexDatabase: SqliteCodeIndexDatabasePort;
  textIndexDatabase: TextIndexSqliteDatabasePort;
  fileSystem?: FileSystemPort;
  ignorePolicy?: WorkspaceIgnorePolicyOptions;
  filePolicy?: WorkspaceIndexingFilePolicyPort;
  treeSitterRuntime?: TreeSitterRuntimePort;
  vector?: WorkspaceIndexRuntimeVectorOptions;
}

export interface WorkspaceIndexRuntime {
  scanner: WorkspaceScanner;
  pipeline: WorkspaceIndexingPipeline;
  textIndex: SqliteTextIndexModule;
  synchronizeEmbeddings: boolean;
  vectorIndex?: VectorIndexReadPort;
  embeddingProvider?: EmbeddingProvider;
  close(): Promise<void>;
}

export async function createWorkspaceIndexRuntime(
  options: CreateWorkspaceIndexRuntimeOptions,
): Promise<WorkspaceIndexRuntime> {
  let vectorIndex: VectorIndexReadPort | undefined;

  const components = await new WorkspaceIndexingAdapterFactory().create({
    ...(options.fileSystem ? { fileSystem: options.fileSystem } : {}),
    ...(options.ignorePolicy ? { ignorePolicy: options.ignorePolicy } : {}),
    ...(options.filePolicy ? { filePolicy: options.filePolicy } : {}),
    ...(options.treeSitterRuntime
      ? {
          treeSitterRuntime:
            options.treeSitterRuntime,
        }
      : {}),
    codeIndexDatabase: options.codeIndexDatabase,
    textIndexDatabase: options.textIndexDatabase,
    ...(options.vector
      ? {
          createEmbedding: (textIndex: SqliteTextIndexModule) => {
            const lanceVectorIndex = new LanceDbVectorIndexFactory().create(
              options.vector!.lanceConnection,
              options.vector!.lance,
            );
            const composed = new VectorIndexFactory().create(lanceVectorIndex);
            vectorIndex = composed.reader;
            return new EmbeddingFactory().create(
              {
                provider: options.vector!.embeddingProvider,
                textIndex: textIndex.reader,
                vectorWriter: lanceVectorIndex.writer,
              },
              options.vector!.embedding,
            ).synchronizer;
          },
        }
      : {}),
  });

  return {
    scanner: components.scanner,
    pipeline: components.pipeline,
    textIndex: components.textIndex,
    synchronizeEmbeddings: components.synchronizeEmbeddings,
    ...(vectorIndex && options.vector
      ? {
          vectorIndex,
          embeddingProvider: options.vector.embeddingProvider,
        }
      : {}),
    close: async () => {},
  };
}
