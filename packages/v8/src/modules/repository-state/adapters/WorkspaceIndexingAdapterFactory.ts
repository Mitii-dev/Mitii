import {
  WorkspaceIndexingPipeline,
} from "../pipeline/ws-indexing-pipeline/WorkspaceIndexingPipeline";
import type {
  WorkspaceIndexingEmbeddingSynchronizerPort,
  WorkspaceIndexingFilePolicyPort,
} from "../pipeline/ws-indexing-pipeline/types";
import {
  BoundedWalker,
} from "../internal/shared/bounded-walker/BoundedWalker";
import {
  NodeFileSystemAdapter,
} from "../internal/shared/filesystem/NodeFileSystemAdapter";
import type {
  FileSystemPort,
} from "../internal/shared/filesystem/types";
import {
  WorkspaceScanner,
} from "../internal/workspace/WorkspaceScanner";
import {
  WorkspaceIgnorePolicy,
} from "../internal/workspace/utils/ws-ignore-policy/WorkspaceIgnorePolicy";
import type {
  WorkspaceIgnorePolicyOptions,
} from "../internal/workspace/types";
import {
  SourceFileReader,
} from "../internal/source-analysis/SourceFileReader";
import {
  createSourceAnalysisBuilder,
} from "../internal/source-analysis/SourceAnalysisFactory";
import {
  ChunkingFactory,
} from "../internal/chunking/ChunkingFactory";
import {
  NodeSha256ChunkHasher,
} from "../internal/chunking/adapters/node/NodeSha256ChunkHasher";
import {
  CodeIndexDocumentMapper,
} from "../internal/code-indexing/CodeIndexDocumentMapper";
import {
  CodeIndexPreparedFileIndexer,
} from "../internal/code-indexing/CodeIndexPreparedFileIndexer";
import {
  CodeIndexUpdater,
} from "../internal/code-indexing/CodeIndexUpdater";
import {
  SqliteCodeIndexMigration,
} from "../internal/code-indexing/adapters/sqlite/SqliteCodeIndexMigration";
import {
  SqliteCodeIndexWriter,
} from "../internal/code-indexing/adapters/sqlite/SqliteCodeIndexWriter";
import type {
  SqliteCodeIndexDatabasePort,
} from "../internal/code-indexing/types";
import {
  SqliteTextIndexFactory,
} from "../internal/text-index/adapters/sqlite/SqliteTextIndexFactory";
import {
  SqliteTextIndexMigration,
} from "../internal/text-index/adapters/sqlite/SqliteTextIndexMigration";
import type {
  TextIndexSqliteDatabasePort,
  SqliteTextIndexModule,
} from "../internal/text-index/types";

class DisabledEmbeddingSynchronizer
  implements WorkspaceIndexingEmbeddingSynchronizerPort {
  public async synchronize(): Promise<never> {
    throw new Error(
      "Embedding synchronization is not configured for this workspace indexer.",
    );
  }
}

export interface WorkspaceIndexingAdapterFactoryOptions {
  fileSystem?: FileSystemPort;
  ignorePolicy?: WorkspaceIgnorePolicyOptions;
  filePolicy?: WorkspaceIndexingFilePolicyPort;
  codeIndexDatabase: SqliteCodeIndexDatabasePort;
  textIndexDatabase: TextIndexSqliteDatabasePort;
  embedding?: WorkspaceIndexingEmbeddingSynchronizerPort;
  /**
   * Build the embedding synchronizer after the shared text-index module exists
   * so sync reads the same SQLite module the pipeline writes.
   */
  createEmbedding?: (
    textIndex: SqliteTextIndexModule,
  ) => WorkspaceIndexingEmbeddingSynchronizerPort;
}

export interface WorkspaceIndexingAdapterComponents {
  scanner: WorkspaceScanner;
  pipeline: WorkspaceIndexingPipeline;
  textIndex: SqliteTextIndexModule;
  synchronizeEmbeddings: boolean;
}

export class WorkspaceIndexingAdapterFactory {
  public async create(
    options: WorkspaceIndexingAdapterFactoryOptions,
  ): Promise<WorkspaceIndexingAdapterComponents> {
    const fileSystem =
      options.fileSystem ??
      new NodeFileSystemAdapter();

    await new SqliteCodeIndexMigration()
      .migrate(
        options.codeIndexDatabase,
      );
    await new SqliteTextIndexMigration()
      .migrate(
        options.textIndexDatabase,
      );

    const codeWriter =
      new SqliteCodeIndexWriter(
        options.codeIndexDatabase,
      );
    const textIndex =
      new SqliteTextIndexFactory()
        .create(
          options.textIndexDatabase,
        );
    const chunkHasher =
      new NodeSha256ChunkHasher();
    const sourceReader =
      new SourceFileReader(
        fileSystem,
      );
    const sourceAnalyzer =
      createSourceAnalysisBuilder();
    const chunker =
      new ChunkingFactory()
        .create({
          hasher:
            chunkHasher,
        });
    const codeIndexer =
      new CodeIndexPreparedFileIndexer(
        new CodeIndexDocumentMapper(),
        new CodeIndexUpdater(
          codeWriter,
        ),
      );

    const embedding =
      options.embedding ??
      options.createEmbedding?.(
        textIndex,
      );

    return {
      scanner:
        new WorkspaceScanner(
          new BoundedWalker(
            fileSystem,
          ),
          new WorkspaceIgnorePolicy(
            options.ignorePolicy,
          ),
        ),
      pipeline:
        new WorkspaceIndexingPipeline({
          reader:
            sourceReader,
          analyzer:
            sourceAnalyzer,
          contentHasher:
            chunkHasher,
          chunker,
          codeIndexer,
          textIndexer:
            textIndex.coordinator,
          codeIndex:
            codeWriter,
          textIndex:
            {
              removeMissingDocuments:
                (...args) =>
                  textIndex
                    .writer
                    .removeMissingDocuments(
                      ...args,
                    ),
              getRevision:
                (...args) =>
                  textIndex
                    .reader
                    .getRevision(
                      ...args,
                    ),
            },
          embedding:
            embedding ??
            new DisabledEmbeddingSynchronizer(),
          ...(options.filePolicy
            ? {
                filePolicy:
                  options.filePolicy,
              }
            : {}),
        }),
      textIndex,
      synchronizeEmbeddings:
        embedding !== undefined,
    };
  }
}
