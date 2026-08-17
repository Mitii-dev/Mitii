import { describe, expect, it } from "vitest";

import { HYBRID_RETRIEVAL_IDS } from "../internal/hybrid-retrieval/constants";
import { HybridRetriever } from "../internal/hybrid-retrieval/HybridRetriever";
import type {
  RetrievalCandidate,
  RetrievalSource,
  RetrievalSourceResult,
} from "../internal/hybrid-retrieval/types";

class StaticRetrievalSource implements RetrievalSource {
  public constructor(
    public readonly id: string,
    private readonly result: RetrievalSourceResult,
  ) {}

  public canRetrieve(): boolean {
    return true;
  }

  public async retrieve(): Promise<RetrievalSourceResult> {
    return this.result;
  }
}

function candidate(
  relativePath: string,
  chunkId: string,
  sourceScore: number,
): RetrievalCandidate {
  return {
    entityKind: "chunk",
    rootId: "root",
    relativePath,
    chunkId,
    sourceScore,
    reasons: [
      {
        type: "lexical_match",
        evidence: `Matched ${relativePath}.`,
      },
    ],
  };
}

function complete(candidates: RetrievalCandidate[]): RetrievalSourceResult {
  return {
    status: "complete",
    candidates,
    truncated: false,
    warnings: [],
  };
}

describe("folder-scoped hybrid map backfill", () => {
  it("keeps at least 12 in-folder map files when junk lexical hits fill fusion", async () => {
    const folder = "packages/demo";
    const junk = Array.from({ length: 30 }, (_, index) =>
      candidate(
        `apps/docs/src/noise-${String(index).padStart(2, "0")}.ts`,
        `junk-${index}`,
        0.99,
      ),
    );
    const inFolderLexical = [
      candidate(`${folder}/src/file-00.ts`, "in-0", 0.4),
      candidate(`${folder}/src/file-01.ts`, "in-1", 0.4),
    ];
    const mapFiles = Array.from({ length: 16 }, (_, index) =>
      candidate(
        `${folder}/src/file-${String(index).padStart(2, "0")}.ts`,
        `map-${index}`,
        0.5,
      ),
    );

    const result = await new HybridRetriever([
      {
        source: new StaticRetrievalSource(
          "lexical",
          complete([...junk, ...inFolderLexical]),
        ),
      },
      {
        source: new StaticRetrievalSource("semantic", complete(junk)),
      },
      {
        source: new StaticRetrievalSource(
          HYBRID_RETRIEVAL_IDS.REPO_MAP_SOURCE,
          complete(mapFiles),
        ),
        weight: 0.2,
      },
    ]).retrieve({
      workspace: "workspace",
      query: "fix all the ts errors",
      folderPrefix: folder,
      maximumResults: 40,
    });

    const inFolder = result.candidates.filter(
      (item) =>
        item.relativePath === folder ||
        item.relativePath.startsWith(`${folder}/`),
    );
    expect(inFolder.length).toBeGreaterThanOrEqual(12);
    expect(
      inFolder.every((item) => item.relativePath.startsWith(`${folder}/`)),
    ).toBe(true);
  });
});
