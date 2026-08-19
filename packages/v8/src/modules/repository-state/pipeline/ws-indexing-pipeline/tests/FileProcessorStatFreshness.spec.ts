import { describe, expect, it, vi } from "vitest";

import { TEXT_INDEX_DEFAULTS } from "../../../internal/text-index/constants";
import { WorkspaceIndexingFileProcessor } from "../WorkspaceIndexingFileProcessor";
import type {
  NormalizedWorkspaceIndexingPipelineInput,
  WorkspaceIndexingFileProcessorDependencies,
} from "../types";
import type { WorkspaceFileEntry } from "../../../internal/workspace/types";

const CONTENT_HASH = "b".repeat(64);
const MODIFIED_AT = "2026-08-18T12:00:00.000Z";

const file = (relativePath: string): WorkspaceFileEntry => ({
  kind: "file",
  rootId: "root",
  relativePath,
  providerPath: `/workspace/${relativePath}`,
  depth: relativePath.split("/").length,
  size: 20,
  modifiedAt: MODIFIED_AT,
});

const request = (
  target: WorkspaceFileEntry,
): NormalizedWorkspaceIndexingPipelineInput => ({
  workspace: "workspace",
  snapshot: {
    schemaVersion: 1,
    snapshotId: "a".repeat(64),
    roots: [{ id: "root", name: "root", kind: "directory" }],
    entries: [target],
    warnings: [],
    statistics: {
      files: 1,
      directories: 0,
      symbolicLinks: 0,
      otherEntries: 0,
      ignoredEntries: 0,
      warnings: 0,
      durationMs: 1,
    },
    limits: {
      maximumDepth: 20,
      maximumFiles: 1000,
      maximumDirectories: 1000,
      timeoutMs: 5000,
      followSymbolicLinks: false,
    },
    status: "complete",
    generatedAt: MODIFIED_AT,
  },
  indexedAt: 1,
  rootIds: ["root"],
  filePaths: [],
  maximumFiles: 1000,
  concurrency: 1,
  maximumReportedFileResults: 1000,
  analysisVersion: "source-analysis-v1",
  textPipelineVersion: TEXT_INDEX_DEFAULTS.PIPELINE_VERSION,
  chunkingOptions: {},
  failureMode: "best_effort",
  cleanupMissing: false,
  synchronizeEmbeddings: false,
});

describe("WorkspaceIndexingFileProcessor catalog freshness", () => {
  it("does not read a file when size and mtime match the code index", async () => {
    const target = file("src/LoginForm.ts");
    const read = vi.fn();
    const processor = new WorkspaceIndexingFileProcessor({
      reader: { read },
      analyzer: { analyze: vi.fn() },
      contentHasher: { id: "test", hash: vi.fn() },
      chunker: { chunk: vi.fn() },
      codeIndexer: { index: vi.fn() },
      textIndexer: { index: vi.fn() },
      freshness: {
        getCodeFileState: async () => ({
          workspace: "workspace",
          rootId: "root",
          relativePath: target.relativePath,
          providerPath: target.providerPath,
          contentHash: CONTENT_HASH,
          size: target.size ?? 0,
          modifiedAt: MODIFIED_AT,
          analysisVersion: "source-analysis-v1",
          analysisStatus: "complete",
          indexedAt: 1,
        }),
        getTextDocumentState: async () => ({
          workspace: "workspace",
          rootId: "root",
          relativePath: target.relativePath,
          sourceId: `source:root:${encodeURIComponent(target.relativePath)}`,
          sourceContentHash: CONTENT_HASH,
          pipelineVersion: TEXT_INDEX_DEFAULTS.PIPELINE_VERSION,
          chunkingStatus: "complete",
          chunkCount: 1,
          workspaceSnapshotId: "a".repeat(64),
          indexedAt: 1,
        }),
      },
    } as unknown as WorkspaceIndexingFileProcessorDependencies);

    const result = await processor.process({
      request: request(target),
      selected: { file: target, sourceId: "source:root:LoginForm" },
    });

    expect(read).not.toHaveBeenCalled();
    expect(result.status).toBe("complete");
    expect(result.codeIndexStatus).toBe("unchanged");
    expect(result.textIndexStatus).toBe("unchanged");
    expect(result.contentHash).toBe(CONTENT_HASH);
  });

  it("reads the file when mtime changed", async () => {
    const target = file("src/LoginForm.ts");
    const read = vi.fn(async () => ({
      sourceId: "source:root:LoginForm",
      rootId: "root",
      relativePath: target.relativePath,
      providerPath: target.providerPath,
      content: "export const LoginForm = 1;",
      byteLength: 28,
    }));
    const processor = new WorkspaceIndexingFileProcessor({
      reader: { read },
      analyzer: {
        analyze: async () => ({
          schemaVersion: 1,
          sourceId: "source:root:LoginForm",
          rootId: "root",
          relativePath: target.relativePath,
          language: "typescript",
          languageSource: "extension",
          parserId: "test",
          quality: "precise",
          status: "complete",
          symbols: [],
          imports: [],
          references: [],
          warnings: [],
        }),
      },
      contentHasher: { id: "test", hash: () => "c".repeat(64) },
      chunker: {
        chunk: async () => ({
          schemaVersion: 1,
          sourceId: "source:root:LoginForm",
          rootId: "root",
          relativePath: target.relativePath,
          language: "typescript",
          sourceContentHash: "c".repeat(64),
          strategyId: "code",
          status: "complete",
          chunks: [],
          warnings: [],
          statistics: {
            inputCharacters: 1,
            processedCharacters: 1,
            omittedCharacters: 0,
            inputLines: 1,
            emittedChunks: 0,
            estimatedTokens: 1,
          },
        }),
      },
      codeIndexer: {
        index: async () => ({
          status: "indexed",
          analysis: {
            schemaVersion: 1,
            sourceId: "source:root:LoginForm",
            rootId: "root",
            relativePath: target.relativePath,
            language: "typescript",
            languageSource: "extension",
            parserId: "test",
            quality: "precise",
            status: "complete",
            symbols: [],
            imports: [],
            references: [],
            warnings: [],
          },
          update: {
            status: "indexed",
            plan: { action: "replace", reason: "content_changed" },
          },
        }),
      },
      textIndexer: {
        index: async () => ({
          schemaVersion: 1,
          status: "indexed",
          chunkingStatus: "complete",
          update: {
            status: "indexed",
            plan: { action: "replace", reason: "content_changed" },
          },
        }),
      },
      freshness: {
        getCodeFileState: async () => ({
          workspace: "workspace",
          rootId: "root",
          relativePath: target.relativePath,
          providerPath: target.providerPath,
          contentHash: CONTENT_HASH,
          size: target.size ?? 0,
          modifiedAt: "2020-01-01T00:00:00.000Z",
          analysisVersion: "source-analysis-v1",
          analysisStatus: "complete",
          indexedAt: 1,
        }),
        getTextDocumentState: async () => ({
          workspace: "workspace",
          rootId: "root",
          relativePath: target.relativePath,
          sourceId: "source:root:LoginForm",
          sourceContentHash: CONTENT_HASH,
          pipelineVersion: TEXT_INDEX_DEFAULTS.PIPELINE_VERSION,
          chunkingStatus: "complete",
          chunkCount: 1,
          workspaceSnapshotId: "a".repeat(64),
          indexedAt: 1,
        }),
      },
    } as unknown as WorkspaceIndexingFileProcessorDependencies);

    await processor.process({
      request: request(target),
      selected: { file: target, sourceId: "source:root:LoginForm" },
    });

    expect(read).toHaveBeenCalledOnce();
  });
});
