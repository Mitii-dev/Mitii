import { describe, expect, it } from "vitest";

import {
  ChunkingFactory,
  NodeSha256ChunkHasher,
} from "../index";
import type { SourceAnalysis } from "../../source-analysis/types";

function createChunker() {
  return new ChunkingFactory().create({
    hasher: new NodeSha256ChunkHasher(),
  });
}

function analysis(
  sourceId: string,
  relativePath: string,
  symbols: SourceAnalysis["symbols"],
): SourceAnalysis {
  return {
    schemaVersion: 1,
    sourceId,
    rootId: "workspace",
    relativePath,
    language: "typescript",
    languageSource: "explicit",
    parserId: "test",
    quality: "precise",
    status: "complete",
    symbols,
    imports: [],
    references: [],
    warnings: [],
  };
}

describe("AST collapse chunker", () => {
  it("emits a collapsed parent overview and full child methods on overflow", async () => {
    const methodA = [
      "  handleSubmit() {",
      `    ${"a".repeat(120)}`,
      "    return true;",
      "  }",
    ].join("\n");
    const methodB = [
      "  reset() {",
      `    ${"b".repeat(120)}`,
      "    return false;",
      "  }",
    ].join("\n");
    const content = [
      "export class LoginForm {",
      methodA,
      "",
      methodB,
      "}",
      "",
    ].join("\n");

    const result = await createChunker().chunk(
      {
        sourceId: "source:login",
        rootId: "workspace",
        relativePath: "src/LoginForm.ts",
        language: "typescript",
        content,
        sourceAnalysis: analysis("source:login", "src/LoginForm.ts", [
          {
            localId: "class:LoginForm",
            name: "LoginForm",
            kind: "class",
            startLine: 1,
            endLine: 11,
          },
          {
            localId: "method:handleSubmit",
            name: "handleSubmit",
            kind: "method",
            parentLocalId: "class:LoginForm",
            startLine: 2,
            endLine: 5,
          },
          {
            localId: "method:reset",
            name: "reset",
            kind: "method",
            parentLocalId: "class:LoginForm",
            startLine: 7,
            endLine: 10,
          },
        ]),
      },
      {
        targetChunkCharacters: 120,
        maximumChunkCharacters: 250,
        minimumChunkCharacters: 10,
        overlapCharacters: 0,
        boundarySearchCharacters: 20,
      },
    );

    const parent = result.chunks.find(
      (chunk) =>
        chunk.kind === "code_region" &&
        chunk.symbolLocalId === "class:LoginForm",
    );
    const children = result.chunks.filter(
      (chunk) =>
        chunk.kind === "code_symbol" &&
        (chunk.symbolLocalId === "method:handleSubmit" ||
          chunk.symbolLocalId === "method:reset"),
    );

    expect(result.status).toBe("complete");
    expect(result.warnings.some((warning) => warning.code === "collapsed_parent")).toBe(
      true,
    );
    expect(parent?.content).toContain("{ ... }");
    expect(parent?.content).toContain("handleSubmit");
    expect(parent?.content).not.toContain("a".repeat(120));
    expect(
      children.some((chunk) => chunk.symbolLocalId === "method:handleSubmit"),
    ).toBe(true);
    expect(children.some((chunk) => chunk.symbolLocalId === "method:reset")).toBe(
      true,
    );
    expect(children.some((chunk) => chunk.content.includes("a".repeat(120)))).toBe(
      true,
    );
    expect(children.some((chunk) => chunk.content.includes("b".repeat(120)))).toBe(
      true,
    );
  });

  it("keeps a fitting parent as a single symbol chunk", async () => {
    const content = [
      "export class Tiny {",
      "  ok() { return 1; }",
      "}",
    ].join("\n");

    const result = await createChunker().chunk(
      {
        sourceId: "source:tiny",
        rootId: "workspace",
        relativePath: "src/Tiny.ts",
        language: "typescript",
        content,
        sourceAnalysis: analysis("source:tiny", "src/Tiny.ts", [
          {
            localId: "class:Tiny",
            name: "Tiny",
            kind: "class",
            startLine: 1,
            endLine: 3,
          },
          {
            localId: "method:ok",
            name: "ok",
            kind: "method",
            parentLocalId: "class:Tiny",
            startLine: 2,
            endLine: 2,
          },
        ]),
      },
      {
        maximumChunkCharacters: 2_200,
      },
    );

    const parent = result.chunks.find(
      (chunk) => chunk.symbolLocalId === "class:Tiny",
    );

    expect(
      result.chunks.filter((chunk) => chunk.symbolLocalId === "method:ok"),
    ).toHaveLength(0);
    expect(parent?.kind).toBe("code_symbol");
    expect(parent?.content).toContain("ok()");
    expect(
      result.warnings.some((warning) => warning.code === "collapsed_parent"),
    ).toBe(false);
  });
});
