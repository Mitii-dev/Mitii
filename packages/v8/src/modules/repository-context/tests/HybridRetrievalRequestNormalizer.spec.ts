import { describe, expect, it } from "vitest";

import { HybridRetrievalRequestNormalizer } from "../internal/hybrid-retrieval/HybridRetrievalRequestNormalizer";
import { HybridRetrieverOptionsResolver } from "../internal/hybrid-retrieval/HybridRetrieverOptionsResolver";
import type { RepoMap } from "../../repository-state";

const emptyMap = (workspaceSnapshotId: string): RepoMap => ({
  schemaVersion: 1,
  workspaceSnapshotId,
  codeIndexChangeToken: "change-1",
  entries: [],
  statistics: {
    availableFiles: 0,
    rankedFiles: 0,
    includedFiles: 0,
    includedSymbols: 0,
    estimatedTokens: 0,
    durationMs: 0,
  },
  status: "complete",
  generatedAt: new Date(0).toISOString(),
});

describe("HybridRetrievalRequestNormalizer", () => {
  const normalizer = new HybridRetrievalRequestNormalizer();
  const options = new HybridRetrieverOptionsResolver().resolve({});

  it("drops stale repo map instead of aborting retrieval", () => {
    const result = normalizer.normalize(
      {
        workspace: "workspace",
        query: "fix types in this package",
        workspaceSnapshotId: "snapshot-a",
        repoMap: emptyMap("snapshot-b"),
      },
      options,
    );

    expect(result.request).toBeDefined();
    expect(result.request?.repoMap).toBeUndefined();
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === "optional_source_unavailable" &&
          /workspace snapshot/i.test(warning.message),
      ),
    ).toBe(true);
  });

  it("promotes directory-like file paths to folderPrefix", () => {
    const result = normalizer.normalize(
      {
        workspace: "workspace",
        query: "fix types in this package",
        filePaths: ["packages/demo"],
      },
      options,
    );

    expect(result.request?.folderPrefix).toBe("packages/demo");
    expect(result.request?.filePaths).toEqual([]);
  });
});
