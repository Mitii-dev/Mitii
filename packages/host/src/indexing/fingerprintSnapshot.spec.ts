import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { enrichFingerprintWithPersistedVectorProfile } from "./fingerprintSnapshot.js";

describe("enrichFingerprintWithPersistedVectorProfile (Phase 5)", () => {
  it("rebinds fingerprint pin snapshotId to persisted full-index fingerprint", () => {
    const mitiiDir = mkdtempSync(join(tmpdir(), "mitii-fp-"));
    writeFileSync(
      join(mitiiDir, "index-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: "ws",
        sqlitePath: join(mitiiDir, "repository-index.sqlite"),
        lanceDbPath: join(mitiiDir, "missing-lance"),
        snapshotFingerprint: "full-index-snap-abc",
        mapRevisionByRoot: { workspace: "map-1" },
        graphRevisionByRoot: { workspace: "graph-1" },
        catalogRevisionByRoot: { workspace: "catalog-1" },
        generatedAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const enriched = enrichFingerprintWithPersistedVectorProfile(
      {
        schemaVersion: 1,
        workspaceId: "ws",
        snapshotId: "fresh-fingerprint-digest",
        scanCompleteness: "complete",
        roots: [
          {
            rootId: "workspace",
            projectCatalogRevision: "catalog_fresh",
            capabilities: [
              {
                capability: "catalog",
                status: "degraded",
                reasonCode: "capability_degraded",
              },
              {
                capability: "codeIndex",
                status: "unavailable",
                reasonCode: "capability_unavailable",
              },
              {
                capability: "textIndex",
                status: "unavailable",
                reasonCode: "capability_unavailable",
              },
              {
                capability: "vectorIndex",
                status: "unavailable",
                reasonCode: "capability_unavailable",
              },
            ],
          },
        ],
        reasons: [],
      },
      mitiiDir,
    );

    expect(enriched.snapshotId).toBe("full-index-snap-abc");
    expect(enriched.roots[0]?.mapRevision).toBe("map-1");
    expect(enriched.roots[0]?.graphRevision).toBe("graph-1");
    expect(enriched.roots[0]?.projectCatalogRevision).toBe("catalog-1");
  });
});
