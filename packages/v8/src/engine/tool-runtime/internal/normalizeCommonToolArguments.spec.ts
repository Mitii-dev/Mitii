import { describe, expect, it } from "vitest";

import { normalizeCommonToolArguments } from "./normalizeCommonToolArguments";
import { coerceArgumentsToSchema } from "./CoerceArgumentsToSchema";
import {
  runReadonlyCommandInputSchema,
  searchFilesInputSchema,
} from "./ToolCatalog";

describe("normalizeCommonToolArguments", () => {
  it("maps search_files pattern → query and drops Cursor Grep keys", () => {
    const normalized = normalizeCommonToolArguments("search_files", {
      pattern: "AnythingLLM",
      path: ".",
      output_mode: "content",
      maxMatches: "50",
    });
    expect(normalized).toEqual({
      query: "AnythingLLM",
      path: ".",
      maxMatches: 50,
    });
    expect(
      searchFilesInputSchema.parse(
        coerceArgumentsToSchema(normalized, searchFilesInputSchema),
      ),
    ).toMatchObject({ query: "AnythingLLM", maxMatches: 50 });
  });

  it("maps run_readonly_command command string → argv", () => {
    const normalized = normalizeCommonToolArguments("run_readonly_command", {
      command: "git status",
    });
    expect(normalized).toEqual({ argv: ["git", "status"] });
    expect(
      runReadonlyCommandInputSchema.parse(
        coerceArgumentsToSchema(normalized, runReadonlyCommandInputSchema),
      ),
    ).toEqual({ argv: ["git", "status"] });
  });

  it("maps run_command quoted command → argv", () => {
    const normalized = normalizeCommonToolArguments("run_command", {
      command: 'echo "hello world"',
    });
    expect(normalized).toEqual({ argv: ["echo", "hello world"] });
  });

  it("leaves valid search_files args alone", () => {
    const input = { query: "kind", path: "logs", mode: "literal" };
    expect(normalizeCommonToolArguments("search_files", input)).toEqual(input);
  });

  it("maps glob alias onto glob_files pattern", () => {
    expect(
      normalizeCommonToolArguments("glob_files", { glob: "**/*.ts" }),
    ).toEqual({ pattern: "**/*.ts" });
  });

  it("maps emit_review_finding aliases before Zod validation", () => {
    const normalized = normalizeCommonToolArguments("emit_review_finding", {
      file: "src/a.ts",
      title: "Null check",
      description: "Missing guard",
      line: 12,
      severity: "high",
      category: "bug",
    });
    expect(normalized).toMatchObject({
      path: "src/a.ts",
      content: "Null check: Missing guard",
      startLine: 12,
      endLine: 12,
      existingCode: expect.any(String),
    });
    expect((normalized as { file?: unknown }).file).toBeUndefined();
  });

  it("maps read_git_show rev alias to revision", () => {
    expect(
      normalizeCommonToolArguments("read_git_show", {
        rev: "HEAD~1",
        path: "a.ts",
      }),
    ).toEqual({ revision: "HEAD~1", path: "a.ts" });
  });
});

describe("coerceArgumentsToSchema numbers", () => {
  it("coerces numeric strings for ZodNumber fields", () => {
    const coerced = coerceArgumentsToSchema(
      { query: "x", maxMatches: "25" },
      searchFilesInputSchema,
    );
    expect(searchFilesInputSchema.parse(coerced)).toMatchObject({
      query: "x",
      maxMatches: 25,
    });
  });
});
