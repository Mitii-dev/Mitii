import { describe, expect, it } from "vitest";

import {
  InMemoryDiagnosticsAdapter,
  InMemoryFileSystemAdapter,
  InMemoryGitAdapter,
  InMemoryProcessAdapter,
  ToolRuntimeError,
  ToolRuntimePipeline,
  directory,
  file,
  toolInvocationInputSchema,
  toolResultSchema,
} from "../index";
import type { RepoGraph } from "../../../modules/repository-state";
import type { ProcessHandler } from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";

const WORKSPACE = "/workspace";

function createRuntime(options?: {
  processHandler?: ProcessHandler;
  expectedCodeIndexChangeToken?: string;
}) {
  const fs = new InMemoryFileSystemAdapter(
    WORKSPACE,
    directory({
      src: directory({
        "util.ts": file("export const n = 1;\nsecret sk-abcdefghijklmnopqrstuvwxyz\n"),
        "other.ts": file("const x = 2;\n"),
      }),
      README: file("hello world\n"),
    }),
  );

  return new ToolRuntimePipeline({
    fileSystem: fs,
    process: new InMemoryProcessAdapter(
      options?.processHandler ??
        (async () => ({
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          timedOut: false,
          cancelled: false,
          truncated: false,
        })),
    ),
    diagnostics: new InMemoryDiagnosticsAdapter([
      {
        path: "src/util.ts",
        severity: "error",
        message: "boom",
        startLine: 1,
      },
    ]),
    git: new InMemoryGitAdapter({
      branch: "main",
      staged: [],
      unstaged: ["src/util.ts"],
      untracked: [],
      raw: "",
    }),
    codeNavigation: {
      id: "test-graph",
      provider: "repo_graph" as const,
      definition: async () => [
        {
          relativePath: "src/util.ts",
          startLine: 1,
          symbolName: "n",
        },
      ],
      references: async () => [
        {
          relativePath: "src/other.ts",
          startLine: 1,
          symbolName: "n",
        },
      ],
    },
    repoGraphs: {
      loadGraphs: async () => [createGraph()],
      ...(options?.expectedCodeIndexChangeToken
        ? {
            expectedCodeIndexChangeToken: async () =>
              options.expectedCodeIndexChangeToken,
          }
        : {}),
    },
  });
}

describe("ToolRuntimePipeline", () => {
  it("validates input/output contracts for a successful read", async () => {
    const runtime = createRuntime();
    const input = {
      schemaVersion: 1 as const,
      callId: "c1",
      toolName: "read_file",
      arguments: { path: "src/util.ts" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    };

    expect(() => toolInvocationInputSchema.parse(input)).not.toThrow();
    const result = await runtime.execute(input);
    expect(() => toolResultSchema.parse(result)).not.toThrow();
    expect(result.status).toBe("succeeded");
    expect(result.redacted).toBe(true);
    expect(String((result.output as { content: string }).content)).toContain(
      "[REDACTED]",
    );
  });

  it("lists capabilities including network tools as available", () => {
    const runtime = createRuntime();
    const caps = runtime.listCapabilities();
    expect(caps.some((c) => c.name === "read_file" && c.status === "available")).toBe(
      true,
    );
    expect(
      caps.some((c) => c.name === "fetch_url" && c.status === "available"),
    ).toBe(true);
  });

  it("rejects tools not present in the grant", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c2",
      toolName: "read_file",
      arguments: { path: "src/util.ts" },
      grant: createReadOnlyGrant({ allowedTools: ["list_directory"] }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("tool_not_allowed");
  });

  it("rejects invalid arguments", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "c3",
      toolName: "read_file",
      arguments: { path: "" },
      grant: createReadOnlyGrant(),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
  });

  it("throws ToolRuntimeError on invalid invocation envelope", async () => {
    const runtime = createRuntime();
    await expect(
      runtime.execute({
        schemaVersion: 1,
        callId: "",
        toolName: "read_file",
        arguments: {},
        grant: createReadOnlyGrant(),
        workspaceRoot: WORKSPACE,
      } as never),
    ).rejects.toBeInstanceOf(ToolRuntimeError);
  });

  it("completes read-only list/search/diagnostics/git without bypass", async () => {
    const runtime = createRuntime();
    const grant = createReadOnlyGrant();

    const listed = await runtime.execute({
      schemaVersion: 1,
      callId: "l1",
      toolName: "list_directory",
      arguments: { path: "src" },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(listed.status).toBe("succeeded");

    const searched = await runtime.execute({
      schemaVersion: 1,
      callId: "s1",
      toolName: "search_files",
      arguments: { query: "export", path: "src" },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(searched.status).toBe("succeeded");
    expect(
      (searched.output as { matches: unknown[] }).matches.length,
    ).toBeGreaterThan(0);

    const diags = await runtime.execute({
      schemaVersion: 1,
      callId: "d1",
      toolName: "read_diagnostics",
      arguments: { paths: ["src/util.ts"] },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(diags.status).toBe("succeeded");

    const missingPathDiags = await runtime.execute({
      schemaVersion: 1,
      callId: "d2",
      toolName: "read_diagnostics",
      arguments: { paths: ["src/deleted.ts"] },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(missingPathDiags.status).toBe("succeeded");
    expect(
      (missingPathDiags.output as { diagnostics: unknown[] }).diagnostics,
    ).toEqual([]);

    const git = await runtime.execute({
      schemaVersion: 1,
      callId: "g1",
      toolName: "read_git_status",
      arguments: {},
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(git.status).toBe("succeeded");

    const definition = await runtime.execute({
      schemaVersion: 1,
      callId: "nav1",
      toolName: "goto_definition",
      arguments: { path: "src/util.ts", line: 1 },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(definition.status).toBe("succeeded");
    expect(
      (definition.output as { locations: Array<{ symbolName?: string }> })
        .locations[0]?.symbolName,
    ).toBe("n");

    const references = await runtime.execute({
      schemaVersion: 1,
      callId: "nav2",
      toolName: "find_references",
      arguments: { path: "src/util.ts", line: 1 },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(references.status).toBe("succeeded");
    expect(
      (references.output as { locations: Array<{ path?: string }> })
        .locations[0]?.path,
    ).toBe("src/other.ts");

    const impact = await runtime.execute({
      schemaVersion: 1,
      callId: "impact1",
      toolName: "analyze_change_impact",
      arguments: { path: "src/util.ts", line: 1, symbolName: "n" },
      grant,
      workspaceRoot: WORKSPACE,
    });
    expect(impact.status).toBe("succeeded");
    expect(
      (impact.output as { affected: Array<{ path?: string }> }).affected[0]
        ?.path,
    ).toBe("src/other.ts");
  });

  it("passes expectedCodeIndexChangeToken for graph_stale impact results", async () => {
    const runtime = createRuntime({
      expectedCodeIndexChangeToken: "newer-than-graph",
    });
    const grant = createReadOnlyGrant();
    const impact = await runtime.execute({
      schemaVersion: 1,
      callId: "impact-stale",
      toolName: "analyze_change_impact",
      arguments: { path: "src/util.ts", line: 1, symbolName: "n" },
      grant,
      workspaceRoot: WORKSPACE,
    });

    expect(impact.status).toBe("succeeded");
    const output = impact.output as {
      status: string;
      reasonCodes: string[];
    };
    expect(output.status).toBe("partial");
    expect(output.reasonCodes).toContain("graph_stale");
    expect(output.reasonCodes).toContain("impact_resolved");
  });

  it("marks analyze_change_impact stale when the run already mutated files", async () => {
    const runtime = createRuntime();
    const grant = createReadOnlyGrant();
    const impact = await runtime.execute(
      {
        schemaVersion: 1,
        callId: "impact-run-dirty",
        toolName: "analyze_change_impact",
        arguments: { path: "src/util.ts", line: 1, symbolName: "n" },
        grant,
        workspaceRoot: WORKSPACE,
      },
      { alreadyMutatedPaths: ["src/util.ts"] },
    );

    expect(impact.status).toBe("succeeded");
    const output = impact.output as {
      status: string;
      reasonCodes: string[];
    };
    expect(output.status).toBe("partial");
    expect(output.reasonCodes).toContain("graph_stale");
  });
});

function createGraph(): RepoGraph {
  return {
    schemaVersion: 1,
    workspaceSnapshotId: "snapshot-1",
    codeIndexChangeToken: "token-1",
    nodes: [
      {
        id: "file:util",
        kind: "file",
        fileId: "file:util",
        rootId: "workspace",
        relativePath: "src/util.ts",
      },
      {
        id: "sym:n",
        kind: "symbol",
        symbolId: "sym:n",
        fileId: "file:util",
        name: "n",
        symbolKind: "const",
        startLine: 1,
        endLine: 1,
      },
      {
        id: "file:other",
        kind: "file",
        fileId: "file:other",
        rootId: "workspace",
        relativePath: "src/other.ts",
      },
      {
        id: "sym:useN",
        kind: "symbol",
        symbolId: "sym:useN",
        fileId: "file:other",
        name: "useN",
        symbolKind: "function",
        startLine: 1,
        endLine: 1,
      },
    ],
    edges: [
      {
        id: "edge:useN:n",
        type: "references",
        fromNodeId: "sym:useN",
        toNodeId: "sym:n",
        weight: 2,
        evidenceCount: 1,
        evidence: [
          {
            source: "code_index_reference",
            detail: "useN references n",
            line: 1,
          },
        ],
        evidenceTruncated: false,
      },
    ],
    warnings: [],
    statistics: {
      availableFiles: 2,
      indexedFiles: 2,
      projectNodes: 0,
      fileNodes: 2,
      symbolNodes: 2,
      containsEdges: 0,
      declaresEdges: 0,
      importEdges: 0,
      callEdges: 0,
      referenceEdges: 1,
      projectRelationshipEdges: 0,
      unresolvedImports: 0,
      omittedImportTargets: 0,
      ambiguousReferences: 0,
      unresolvedReferences: 0,
      omittedReferenceTargets: 0,
      omittedParentSymbolTargets: 0,
      truncatedSymbolFiles: 0,
      droppedSymbolNodes: 0,
      droppedEdges: 0,
      consistencyRetries: 0,
      durationMs: 1,
    },
    status: "complete",
    generatedAt: "2026-08-13T00:00:00.000Z",
  };
}
