import {
  WorkspaceIndexingPipeline,
} from "../flow/ws-indexing-pipeline/WorkspaceIndexingPipeline";
import type {
  WorkspaceIndexingEmbeddingSynchronizerPort,
  WorkspaceIndexingFilePolicyPort,
} from "../flow/ws-indexing-pipeline/types";
import {
  BoundedWalker,
} from "../helpers/shared/bounded-walker/BoundedWalker";
import {
  NodeFileSystemAdapter,
} from "../helpers/shared/filesystem/NodeFileSystemAdapter";
import type {
  FileSystemPort,
} from "../helpers/shared/filesystem/types";
import {
  WorkspaceScanner,
} from "../helpers/workspace/WorkspaceScanner";
import {
  WorkspaceIgnorePolicy,
} from "../helpers/workspace/utils/ws-ignore-policy/WorkspaceIgnorePolicy";
import type {
  WorkspaceIgnorePolicyOptions,
} from "../helpers/workspace/types";
import type {
  TreeSitterRuntimePort,
} from "../contracts";
import {
  SourceFileReader,
} from "../helpers/source-analysis/SourceFileReader";
import {
  createSourceAnalysisBuilder,
} from "../helpers/source-analysis/SourceAnalysisFactory";
import {
  ChunkingFactory,
} from "../helpers/chunking/ChunkingFactory";
import {
  NodeSha256ChunkHasher,
} from "../helpers/chunking/adapters/node/NodeSha256ChunkHasher";
import {
  CodeIndexDocumentMapper,
} from "../helpers/code-indexing/CodeIndexDocumentMapper";
import {
  CodeIndexPreparedFileIndexer,
} from "../helpers/code-indexing/CodeIndexPreparedFileIndexer";
import {
  CodeIndexUpdater,
} from "../helpers/code-indexing/CodeIndexUpdater";
import {
  SqliteCodeIndexMigration,
} from "../helpers/code-indexing/adapters/sqlite/SqliteCodeIndexMigration";
import {
  SqliteCodeIndexWriter,
} from "../helpers/code-indexing/adapters/sqlite/SqliteCodeIndexWriter";
import type {
  SqliteCodeIndexDatabasePort,
} from "../helpers/code-indexing/types";
import {
  SqliteTextIndexFactory,
} from "../helpers/text-index/adapters/sqlite/SqliteTextIndexFactory";
import {
  SqliteTextIndexMigration,
} from "../helpers/text-index/adapters/sqlite/SqliteTextIndexMigration";
import type {
  TextIndexSqliteDatabasePort,
  SqliteTextIndexModule,
} from "../helpers/text-index/types";

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
  treeSitterRuntime?: TreeSitterRuntimePort;
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
      createSourceAnalysisBuilder({
        ...(options.treeSitterRuntime
          ? {
              treeSitterRuntime:
                options.treeSitterRuntime,
            }
          : {}),
      });
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
          new WorkspaceIgnorePolicy({
            ...(options.ignorePolicy ?? {}),
            fileSystem: options.ignorePolicy?.fileSystem ?? fileSystem,
          }),
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
          freshness:
            {
              getCodeFileState:
                (...args) =>
                  codeWriter
                    .getFileState(
                      ...args,
                    ),
              getTextDocumentState:
                (...args) =>
                  textIndex
                    .writer
                    .getDocumentState(
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
