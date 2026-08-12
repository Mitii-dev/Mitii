import { describe, expect, it } from "vitest";

import type { RepoGraph } from "../../repository-state";
import {
  CODE_NAVIGATION_SCHEMA_VERSION,
  CodeNavigationError,
  CodeNavigationPipeline,
  FallbackCodeNavigationAdapter,
  GraphCodeNavigationAdapter,
  codeNavigationInputSchema,
} from "../index";
import type { CodeNavigationPort } from "../index";

function sampleGraph(): RepoGraph {
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snapshot",
    codeIndexChangeToken: "token",
    status: "complete",
    generatedAt: new Date(0).toISOString(),
    warnings: [],
    statistics: {
      nodeCount: 3,
      edgeCount: 1,
      fileCount: 2,
      symbolCount: 2,
      projectCount: 0,
    } as RepoGraph["statistics"],
    nodes: [
      {
        id: "file:auth.ts",
        kind: "file",
        fileId: "file:auth.ts",
        rootId: "workspace",
        relativePath: "src/auth.ts",
      },
      {
        id: "file:login.ts",
        kind: "file",
        fileId: "file:login.ts",
        rootId: "workspace",
        relativePath: "src/login.ts",
      },
      {
        id: "sym:validateJwt",
        kind: "symbol",
        symbolId: "sym:validateJwt",
        fileId: "file:auth.ts",
        name: "validateJwt",
        symbolKind: "function",
        startLine: 4,
        endLine: 12,
        signature: "export function validateJwt(token: string): boolean",
      },
      {
        id: "sym:login",
        kind: "symbol",
        symbolId: "sym:login",
        fileId: "file:login.ts",
        name: "login",
        symbolKind: "function",
        startLine: 8,
        endLine: 20,
      },
    ],
    edges: [
      {
        id: "edge:login-calls-jwt",
        type: "calls",
        fromNodeId: "sym:login",
        toNodeId: "sym:validateJwt",
        weight: 1,
        evidenceCount: 1,
        evidence: [{ source: "code_index_reference", line: 10 }],
        evidenceTruncated: false,
      },
    ],
  };
}

describe("CodeNavigationPipeline", () => {
  it("rejects invalid input with a stable error code", async () => {
    const pipeline = new CodeNavigationPipeline();
    await expect(
      pipeline.navigate({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "definition",
        query: {
          relativePath: "",
          line: 1,
        },
      } as never),
    ).rejects.toMatchObject({
      name: "CodeNavigationError",
      code: "invalid_input",
    });
    expect(CodeNavigationError.name).toBe("CodeNavigationError");
  });

  it("returns unavailable when no port is configured", async () => {
    const pipeline = new CodeNavigationPipeline();
    const result = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "definition",
        query: { relativePath: "src/auth.ts", line: 4 },
      }),
    );
    expect(result.status).toBe("unavailable");
    expect(result.reasonCodes).toContain("port_unavailable");
  });

  it("resolves definitions and call references from the repo graph", async () => {
    const port = new GraphCodeNavigationAdapter({
      loadGraphs: () => [sampleGraph()],
    });
    const pipeline = new CodeNavigationPipeline({ navigation: port });

    const definition = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "definition",
        query: { relativePath: "src/auth.ts", line: 6 },
      }),
    );
    expect(definition.status).toBe("resolved");
    expect(definition.provider).toBe("repo_graph");
    expect(definition.locations[0]?.symbolName).toBe("validateJwt");
    expect(definition.reasonCodes).toContain("repo_graph_fallback");

    const references = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "references",
        query: {
          relativePath: "src/auth.ts",
          line: 4,
          includeDeclaration: false,
        },
      }),
    );
    expect(references.locations.some((item) => item.relativePath === "src/login.ts")).toBe(
      true,
    );

    const hover = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "hover",
        query: { relativePath: "src/auth.ts", line: 4 },
      }),
    );
    expect(hover.hover?.contents).toContain("validateJwt");
  });

  it("uses the language-server port first and falls back to the graph", async () => {
    const lsp: CodeNavigationPort = {
      id: "lsp",
      provider: "language_server",
      definition: async () => [
        {
          relativePath: "src/auth.ts",
          startLine: 4,
          symbolName: "validateJwt",
        },
      ],
      references: async () => {
        throw new Error("LSP references unavailable");
      },
    };
    const port = new FallbackCodeNavigationAdapter({
      primary: lsp,
      fallback: new GraphCodeNavigationAdapter({
        loadGraphs: () => [sampleGraph()],
      }),
    });
    const pipeline = new CodeNavigationPipeline({ navigation: port });

    const definition = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "definition",
        query: { relativePath: "src/auth.ts", line: 4 },
      }),
    );
    expect(definition.provider).toBe("language_server");
    expect(definition.locations[0]?.symbolName).toBe("validateJwt");

    const references = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "references",
        query: { relativePath: "src/auth.ts", line: 4 },
      }),
    );
    expect(references.locations.length).toBeGreaterThan(0);
  });
});
