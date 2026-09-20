import { describe, expect, it } from "vitest";

import {
  RepoGraphBuilder,
} from "../internal/repo-graph/RepoGraphBuilder";

import type {
  ProjectCatalog,
} from "../internal/catalog/types";

import type {
  CodeIndexContext,
  CodeIndexFile,
  CodeIndexImport,
  CodeIndexReadPort,
  CodeIndexReference,
  CodeIndexSymbol,
  CodeIndexSymbolQuery,
  CodeIndexSymbolQueryResult,
} from "../internal/code-index/types";

import type {
  WorkspaceSnapshot,
} from "../internal/workspace/types";

describe("RepoGraphBuilder call edges", () => {
  it("emits call edges from enclosing caller symbols to callee symbols", async () => {
    const codeIndex =
      new FakeCodeIndex();
    const graph =
      await new RepoGraphBuilder(
        codeIndex,
      ).build({
        snapshot:
          createSnapshot(),
        catalog:
          createCatalog(),
      });

    const callEdge =
      graph.edges.find(
        (edge) =>
          edge.type === "calls",
      );

    expect(callEdge).toMatchObject({
      type: "calls",
      fromNodeId:
        "symbol:caller",
      toNodeId:
        "symbol:callee",
      evidence: [
        {
          source:
            "code_index_reference",
          detail:
            "call",
          line:
            4,
        },
      ],
    });
    expect(
      graph.statistics.callEdges,
    ).toBe(1);
    expect(
      graph.statistics.referenceEdges,
    ).toBe(1);
  });

  it("emits implements edges from the enclosing type to the implemented symbol", async () => {
    const codeIndex = new FakeCodeIndex({
      files: [
        {
          id: "file:child",
          rootId: "root",
          relativePath: "src/child.ts",
          language: "typescript",
        },
        {
          id: "file:port",
          rootId: "root",
          relativePath: "src/port.ts",
          language: "typescript",
        },
      ],
      symbols: [
        [
          "file:child",
          [
            {
              id: "symbol:child",
              fileId: "file:child",
              name: "Child",
              kind: "class",
              startLine: 1,
              endLine: 6,
            },
          ],
        ],
        [
          "file:port",
          [
            {
              id: "symbol:port",
              fileId: "file:port",
              name: "Port",
              kind: "interface",
              startLine: 1,
              endLine: 3,
            },
          ],
        ],
      ],
      references: [
        {
          fromFileId: "file:child",
          symbolName: "Port",
          kind: "implements",
          line: 2,
          resolution: "resolved",
          toFileId: "file:port",
          toSymbolId: "symbol:port",
        },
      ],
    });

    const graph = await new RepoGraphBuilder(codeIndex).build({
      snapshot: createSnapshot(),
      catalog: createCatalog(),
    });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "implements",
          fromNodeId: "symbol:child",
          toNodeId: "symbol:port",
        }),
        expect.objectContaining({
          type: "references",
          fromNodeId: "file:child",
          toNodeId: "symbol:port",
        }),
      ]),
    );
    expect(graph.statistics.heritageEdges).toBe(1);
  });
});

class FakeCodeIndex
  implements CodeIndexReadPort
{
  public readonly id =
    "fake-code-index";

  private readonly extraReferences: CodeIndexReference[];

  constructor(
    extras: {
      files?: CodeIndexFile[];
      symbols?: Array<[string, CodeIndexSymbol[]]>;
      references?: CodeIndexReference[];
    } = {},
  ) {
    this.files.push(...(extras.files ?? []));
    for (const [fileId, symbols] of extras.symbols ?? []) {
      this.symbols.set(fileId, [
        ...(this.symbols.get(fileId) ?? []),
        ...symbols,
      ]);
    }
    this.extraReferences = extras.references ?? [];
  }

  private readonly files:
    CodeIndexFile[] = [
    {
      id:
        "file:caller",
      rootId:
        "root",
      relativePath:
        "src/caller.ts",
      language:
        "typescript",
    },
    {
      id:
        "file:callee",
      rootId:
        "root",
      relativePath:
        "src/callee.ts",
      language:
        "typescript",
    },
  ];

  private readonly symbols =
    new Map<
      string,
      CodeIndexSymbol[]
    >([
      [
        "file:caller",
        [
          {
            id:
              "symbol:caller",
            fileId:
              "file:caller",
            name:
              "caller",
            kind:
              "function",
            startLine:
              1,
            endLine:
              8,
          },
        ],
      ],
      [
        "file:callee",
        [
          {
            id:
              "symbol:callee",
            fileId:
              "file:callee",
            name:
              "callee",
            kind:
              "function",
            startLine:
              1,
            endLine:
              3,
          },
        ],
      ],
    ]);

  public async getChangeToken(): Promise<string> {
    return "change-1";
  }

  public async getFiles() {
    return {
      files:
        this.files,
      totalAvailable:
        this.files.length,
      truncated:
        false,
    };
  }

  public async getSymbols(
    query:
      CodeIndexSymbolQuery,
  ): Promise<CodeIndexSymbolQueryResult> {
    return {
      symbolsByFile:
        new Map(
          query.fileIds.map(
            (fileId) => [
              fileId,
              this.symbols.get(
                fileId,
              ) ?? [],
            ],
          ),
        ),
      truncatedFileIds: [],
    };
  }

  public async getImports(): Promise<
    readonly CodeIndexImport[]
  > {
    return [];
  }

  public async getReferences(
    _fromFileIds:
      readonly string[],
    _context:
      CodeIndexContext,
  ): Promise<
    readonly CodeIndexReference[]
  > {
    return [
      {
        fromFileId:
          "file:caller",
        symbolName:
          "callee",
        kind:
          "call",
        line:
          4,
        resolution:
          "resolved",
        toFileId:
          "file:callee",
        toSymbolId:
          "symbol:callee",
      },
      ...this.extraReferences,
    ];
  }
}

function createSnapshot(): WorkspaceSnapshot {
  return {
    schemaVersion:
      1,
    snapshotId:
      "snapshot-1",
    roots: [
      {
        id:
          "root",
        name:
          "root",
        providerPath:
          "/workspace",
        kind:
          "directory",
      },
    ],
    entries: [],
    warnings: [],
    statistics: {
      files:
        2,
      directories:
        0,
      symbolicLinks:
        0,
      otherEntries:
        0,
      ignoredEntries:
        0,
      warnings:
        0,
      durationMs:
        0,
    },
    limits: {
      maximumDepth:
        10,
      maximumFiles:
        100,
      maximumDirectories:
        100,
      timeoutMs:
        1_000,
      followSymbolicLinks:
        false,
    },
    status:
      "complete",
    generatedAt:
      new Date(0)
        .toISOString(),
  };
}

function createCatalog(): ProjectCatalog {
  return {
    schemaVersion:
      1,
    workspaceSnapshotId:
      "snapshot-1",
    projects: [],
    relationships: [],
    warnings: [],
    status:
      "complete",
    generatedAt:
      new Date(0)
        .toISOString(),
  };
}
