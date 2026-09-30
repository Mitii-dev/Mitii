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
      {
        id: "sym:port",
        kind: "symbol",
        symbolId: "sym:port",
        fileId: "file:auth.ts",
        name: "AuthPort",
        symbolKind: "interface",
        startLine: 14,
        endLine: 16,
      },
      {
        id: "sym:child",
        kind: "symbol",
        symbolId: "sym:child",
        fileId: "file:login.ts",
        name: "JwtAuth",
        symbolKind: "class",
        startLine: 22,
        endLine: 30,
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
      {
        id: "edge:jwt-implements-port",
        type: "implements",
        fromNodeId: "sym:child",
        toNodeId: "sym:port",
        weight: 1,
        evidenceCount: 1,
        evidence: [{ source: "code_index_reference", detail: "implements", line: 22 }],
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

    const symbols = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "document_symbols",
        query: { relativePath: "src/auth.ts" },
      }),
    );
    expect(symbols.locations.map((item) => item.symbolName)).toContain("validateJwt");

    const graph = new GraphCodeNavigationAdapter({
      loadGraphs: () => [sampleGraph()],
    });
    expect(graph.capability().status).toBe("degraded");
    expect(graph.capability().reason).toBe("language_server_not_configured");
  });

  it("searches workspace symbols from the graph", async () => {
    const pipeline = new CodeNavigationPipeline({
      navigation: new GraphCodeNavigationAdapter({
        loadGraphs: () => [sampleGraph()],
      }),
    });
    const found = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "workspace_symbols",
      query: { query: "login" },
    });
    expect(found.status).toBe("resolved");
    expect(found.locations[0]?.symbolName).toBe("login");

    const implementations = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "implementation",
      query: { relativePath: "src/auth.ts", line: 14 },
    });
    expect(implementations.status).toBe("resolved");
    expect(implementations.locations.map((item) => item.symbolName)).toContain("JwtAuth");

    const callees = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "call_hierarchy",
      query: { relativePath: "src/login.ts", line: 8, direction: "outgoing" },
    });
    expect(callees.status).toBe("resolved");
    expect(callees.reasonCodes).toContain("call_hierarchy_resolved");
    expect(callees.locations.map((item) => item.symbolName)).toContain("validateJwt");

    const callers = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "call_hierarchy",
      query: { relativePath: "src/auth.ts", line: 4, direction: "incoming" },
    });
    expect(callers.locations.map((item) => item.symbolName)).toContain("login");
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
    expect(definition.truncated).toBe(false);

    const references = await pipeline.navigate(
      codeNavigationInputSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        operation: "references",
        query: { relativePath: "src/auth.ts", line: 4 },
      }),
    );
    expect(references.locations.length).toBeGreaterThan(0);
    expect(references.provider).toBe("repo_graph");
    expect(references.reasonCodes).toContain("repo_graph_fallback");
  });

  it("reports truncation when locations exceed maximumLocations", async () => {
    const port: CodeNavigationPort = {
      id: "many",
      provider: "language_server",
      definition: async () =>
        Array.from({ length: 5 }, (_, index) => ({
          relativePath: `src/file${index}.ts`,
          startLine: index + 1,
          symbolName: `sym${index}`,
        })),
      references: async () => [],
    };
    const pipeline = new CodeNavigationPipeline({ navigation: port });
    const result = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "definition",
      query: { relativePath: "src/file0.ts", line: 1 },
      maximumLocations: 2,
    });
    expect(result.status).toBe("resolved");
    expect(result.locations).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.reasonCodes).toContain("locations_truncated");
  });

  it("clamps oversized hover contents", async () => {
    const port: CodeNavigationPort = {
      id: "hover",
      provider: "language_server",
      definition: async () => [],
      references: async () => [],
      hover: async () => ({
        contents: "x".repeat(5_000),
        language: "typescript",
      }),
    };
    const pipeline = new CodeNavigationPipeline({ navigation: port });
    const result = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "hover",
      query: { relativePath: "src/a.ts", line: 1 },
    });
    expect(result.status).toBe("resolved");
    expect(result.truncated).toBe(true);
    expect(result.reasonCodes).toContain("hover_truncated");
    expect(result.hover?.contents.length).toBeLessThanOrEqual(4_001);
  });

  it("resolves type_definition and calls prepare before caret ops", async () => {
    const prepared: string[] = [];
    const port: CodeNavigationPort = {
      id: "typed",
      provider: "language_server",
      prepare: async (relativePath) => {
        prepared.push(relativePath);
      },
      definition: async () => [],
      typeDefinition: async () => [
        {
          relativePath: "src/types.ts",
          startLine: 2,
          symbolName: "User",
          symbolKind: "interface",
        },
      ],
      references: async () => [],
    };
    const pipeline = new CodeNavigationPipeline({ navigation: port });
    const result = await pipeline.navigate({
      schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
      operation: "type_definition",
      query: { relativePath: "src/main.ts", line: 4, column: 10 },
    });
    expect(prepared).toEqual(["src/main.ts"]);
    expect(result.status).toBe("resolved");
    expect(result.reasonCodes).toContain("type_definition_resolved");
    expect(result.locations[0]?.symbolName).toBe("User");
  });
});
