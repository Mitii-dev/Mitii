import { describe, expect, it } from "vitest";

import { SQLITE_CODE_INDEX_SQL } from "../../constants";
import { CodeIndexIdBuilder } from "../../CodeIndexIdBuilder";

import type {
  CodeIndexContext,
  SqliteReadPort,
} from "../../types";

import { SqliteCodeIndexAdapter } from "./SqliteCodeIndexAdapter";
import {
  deduplicateImports,
  parseImportedNames,
} from "./sqliteGetImports";

const ROOT_ID = "root";
const ids = new CodeIndexIdBuilder();
const fileId = (relativePath: string): string =>
  ids.createFileId({ rootId: ROOT_ID, relativePath });

type RowsBySql = Partial<
  Record<keyof typeof SQLITE_CODE_INDEX_SQL, unknown[]>
>;

function createPort(rows: RowsBySql): SqliteReadPort {
  return {
    prepare(sql: string) {
      const key = (
        Object.keys(SQLITE_CODE_INDEX_SQL) as Array<
          keyof typeof SQLITE_CODE_INDEX_SQL
        >
      ).find((name) => sql.startsWith(SQLITE_CODE_INDEX_SQL[name]));

      const result = (key && rows[key]) ?? [];

      return {
        all: () => result,
        get: () => result[0],
      };
    },
  };
}

function createContext(paths: string[]): CodeIndexContext {
  return {
    snapshot: {
      snapshotId: "snap-1",
      entries: paths.map((relativePath) => ({
        kind: "file",
        rootId: ROOT_ID,
        relativePath,
        size: 10,
      })),
    } as unknown as CodeIndexContext["snapshot"],
  };
}

const FILE_ROWS = [
  { id: 1, relativePath: "src/a.ts", indexedAt: 1 },
  { id: 2, relativePath: "src/b.ts", indexedAt: 1 },
];

function createAdapter(rows: RowsBySql): SqliteCodeIndexAdapter {
  return new SqliteCodeIndexAdapter(createPort(rows), {
    workspace: "/repo",
    rootId: ROOT_ID,
  });
}

describe("SqliteCodeIndexAdapter", () => {
  it("rejects invalid options", () => {
    const port = createPort({});

    expect(
      () =>
        new SqliteCodeIndexAdapter(port, {
          workspace: " ",
          rootId: ROOT_ID,
        }),
    ).toThrow("workspace must not be empty.");

    expect(
      () =>
        new SqliteCodeIndexAdapter(port, {
          workspace: "/repo",
          rootId: ROOT_ID,
          sqlBatchSize: 0,
        }),
    ).toThrow("sqlBatchSize must be a positive safe integer.");
  });

  it("builds a change token from the watermark row", async () => {
    const adapter = createAdapter({
      GET_WATERMARK: [
        { fileCount: 2, indexedAtMaximum: 5, indexedAtSum: 7, idSum: 3 },
      ],
    });

    await expect(
      adapter.getChangeToken(createContext([])),
    ).resolves.toBe("snap-1:/repo:2:5:7:3");
  });

  it("returns snapshot-current indexed files in path order", async () => {
    const adapter = createAdapter({ GET_FILES_PREFIX: FILE_ROWS });

    const result = await adapter.getFiles(
      { maximumFiles: 1 },
      createContext(["src/b.ts", "src/a.ts", "src/missing.ts"]),
    );

    expect(result.totalAvailable).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "src/a.ts",
    ]);
    expect(result.files[0]?.language).toBeDefined();
  });

  it("returns an empty result for a foreign root", async () => {
    const adapter = createAdapter({ GET_FILES_PREFIX: FILE_ROWS });

    await expect(
      adapter.getFiles(
        { maximumFiles: 5, rootIds: ["other"] },
        createContext(["src/a.ts"]),
      ),
    ).resolves.toEqual({
      files: [],
      totalAvailable: 0,
      truncated: false,
    });
  });

  it("splits imports into resolved and unresolved", async () => {
    const adapter = createAdapter({
      GET_FILES_PREFIX: FILE_ROWS,
      GET_IMPORTS_PREFIX: [
        {
          fromFileId: 1,
          targetFileId: 2,
          targetRelativePath: "src/b.ts",
          specifier: "./b",
          line: 1,
          importedNamesJson: '["b"," b ",""]',
        },
        {
          fromFileId: 1,
          targetFileId: null,
          targetRelativePath: "/tmp/absolute.sh",
          specifier: "x",
          line: 2,
          importedNamesJson: null,
        },
      ],
    });

    const imports = await adapter.getImports(
      [fileId("src/a.ts")],
      createContext(["src/a.ts", "src/b.ts"]),
    );

    expect(imports).toHaveLength(2);
    expect(imports[0]).toMatchObject({
      resolution: "resolved",
      toFileId: fileId("src/b.ts"),
      importedNames: ["b"],
    });
    expect(imports[1]).toMatchObject({ resolution: "unresolved" });
  });

  it("marks references with several targets as ambiguous", async () => {
    const adapter = createAdapter({
      GET_FILES_PREFIX: FILE_ROWS,
      GET_REFERENCES_PREFIX: [
        {
          fromFileId: 1,
          symbolName: "run",
          kind: "call",
          line: 3,
          targetFileId: 2,
          targetRelativePath: "src/b.ts",
          targetSymbolName: "run",
          targetSymbolKind: "function",
          targetSymbolStartLine: 1,
        },
        {
          fromFileId: 1,
          symbolName: "run",
          kind: "call",
          line: 3,
          targetFileId: 3,
          targetRelativePath: "src/c.ts",
          targetSymbolName: "run",
          targetSymbolKind: "function",
          targetSymbolStartLine: 2,
        },
        {
          fromFileId: 1,
          symbolName: "gone",
          kind: "call",
          line: 4,
          targetFileId: null,
          targetRelativePath: null,
          targetSymbolName: null,
          targetSymbolKind: null,
          targetSymbolStartLine: null,
        },
      ],
    });

    const references = await adapter.getReferences(
      [fileId("src/a.ts")],
      createContext(["src/a.ts", "src/b.ts", "src/c.ts"]),
    );

    expect(references.map((r) => [r.symbolName, r.resolution])).toEqual([
      ["run", "ambiguous"],
      ["gone", "unresolved"],
    ]);
  });

  it("maps symbols and honors the per-file limit", async () => {
    const symbolRow = (name: string, startLine: number) => ({
      id: startLine,
      fileId: 1,
      name,
      kind: "function",
      signature: null,
      exported: 1,
      startLine,
      endLine: startLine + 1,
      parentName: null,
      parentKind: null,
      parentStartLine: null,
    });

    const adapter = createAdapter({
      GET_FILES_PREFIX: FILE_ROWS,
      GET_SYMBOLS_PREFIX: [symbolRow("a", 1), symbolRow("b", 5)],
    });

    const id = fileId("src/a.ts");

    const result = await adapter.getSymbols(
      { fileIds: [id], maximumSymbolsPerFile: 1 },
      createContext(["src/a.ts"]),
    );

    expect(result.symbolsByFile.get(id)).toHaveLength(1);
    expect(result.truncatedFileIds).toEqual([id]);
  });
});

describe("import helpers", () => {
  it("parses imported names defensively", () => {
    expect(parseImportedNames(null)).toEqual([]);
    expect(parseImportedNames("not json")).toEqual([]);
    expect(parseImportedNames('{"a":1}')).toEqual([]);
    expect(parseImportedNames('["a","a"," b ",1]')).toEqual(["a", "b"]);
  });

  it("deduplicates identical imports", () => {
    const item = {
      resolution: "unresolved" as const,
      fromFileId: "f",
      specifier: "x",
      importedNames: [],
    };

    expect(deduplicateImports([item, { ...item }])).toHaveLength(1);
  });
});
