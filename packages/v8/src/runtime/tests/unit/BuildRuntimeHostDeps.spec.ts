import { describe, expect, it } from "vitest";

import { buildRuntimeHostDeps } from "../../adapters/compose/BuildRuntimeHostDeps";

describe("buildRuntimeHostDeps", () => {
  it("returns empty slice when no host ports", () => {
    expect(buildRuntimeHostDeps({})).toEqual({});
  });

  it("wires enrich + memoryCommit when catalog/store present", () => {
    const slice = buildRuntimeHostDeps({
      workspaceId: "ws_1",
      skillsCatalog: {
        list: async () => [],
        get: async () => undefined,
      } as never,
      memoryStore: {
        put: async () => ({ ok: true }),
        get: async () => undefined,
        query: async () => [],
        delete: async () => ({ ok: true }),
      } as never,
    });
    expect(slice.enrich?.skills).toBeDefined();
    expect(slice.enrich?.memory).toBeDefined();
    expect(slice.memoryCommit).toBeDefined();
    expect(slice.verificationPipeline).toBeUndefined();
  });

  it("wires verificationPipeline + verificationInput together", () => {
    const slice = buildRuntimeHostDeps({
      workspaceRoot: "/tmp/ws",
      workspaceId: "ws_1",
      verification: { verify: async () => ({ status: "verified_success" }) } as never,
    });
    expect(slice.verificationPipeline).toBeDefined();
    expect(typeof slice.verificationInput).toBe("function");
  });

  it("verificationInput builds real input when repo state is pinned", async () => {
    const slice = buildRuntimeHostDeps({
      workspaceRoot: "/tmp/ws",
      workspaceId: "ws_1",
      repositoryState: {
        getLatest: async () => ({
          workspaceId: "ws_1",
          stateToken: "tok_1",
          readiness: "ready",
        }),
      } as never,
      verification: { verify: async () => ({ status: "verified_success" }) } as never,
    });
    const built = await slice.verificationInput?.({
      runId: "run_1",
      request: {
        schemaVersion: 1,
        runId: "run_1",
        required: true,
        checks: ["diagnostics", "tests"],
        allowUnavailable: true,
        onFailure: "report",
        repairPass: 0,
        maxRepairPasses: 2,
        changedPaths: ["packages/checks/src/builtins/http.js"],
      },
    });
    expect(built?.pinnedState.stateToken).toBe("tok_1");
    expect(built?.projects[0]?.rootPath).toBe("packages/checks");
  });
});
