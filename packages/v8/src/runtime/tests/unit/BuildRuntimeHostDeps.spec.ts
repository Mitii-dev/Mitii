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
});
