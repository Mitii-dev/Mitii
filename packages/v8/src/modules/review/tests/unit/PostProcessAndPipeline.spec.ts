import { describe, expect, it } from "vitest";

import { InMemoryReviewRecordStore } from "../..";
import { REVIEW_SARIF_TOOL_NAME } from "../../constants";
import { ReviewPipeline } from "../../pipeline/ReviewPipeline";
import { anchorFindings } from "../../actions/AnchorFindings";
import { repairFindingArgs } from "../../actions/RepairFindingArgs";
import { reflectFindings } from "../../actions/ReflectFindings";
import { exportSarif } from "../../actions/ExportSarif";

describe("anchorFindings", () => {
  it("anchors exact snippet in file content", () => {
    const { findings } = anchorFindings({
      files: [
        {
          path: "src/a.ts",
          diff: "",
          content: "line1\nconst x = 1;\nline3\n",
          insertions: 0,
          deletions: 0,
          isBinary: false,
          isDeleted: false,
          status: "modified",
        },
      ],
      findings: [
        {
          path: "src/a.ts",
          content: "x should be named",
          existingCode: "const x = 1;",
          category: "style",
          severity: "low",
          anchored: false,
        },
      ],
    });
    expect(findings[0]?.anchored).toBe(true);
    expect(findings[0]?.startLine).toBe(2);
  });

  it("soft-fails when snippet missing", () => {
    const { findings, warnings } = anchorFindings({
      files: [
        {
          path: "src/a.ts",
          diff: "",
          content: "hello\n",
          insertions: 0,
          deletions: 0,
          isBinary: false,
          isDeleted: false,
          status: "modified",
        },
      ],
      findings: [
        {
          path: "src/a.ts",
          content: "issue",
          existingCode: "missing",
          category: "other",
          severity: "low",
          anchored: false,
        },
      ],
    });
    expect(findings[0]?.anchored).toBe(false);
    expect(warnings.some((w) => w.code === "anchor_failed")).toBe(true);
  });
});

describe("repairFindingArgs", () => {
  it("parses stringified JSON and normalizes enums", () => {
    const { findings, warnings } = repairFindingArgs(
      JSON.stringify({
        path: "a.ts",
        content: "bug",
        existing_code: "foo()",
        severity: "blocker",
        category: "unknown",
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.category).toBe("other");
    expect(findings[0]?.existingCode).toBe("foo()");
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("drops invalid entries", () => {
    const { findings } = repairFindingArgs([{ path: "", content: "", existingCode: "" }]);
    expect(findings).toHaveLength(0);
  });
});

describe("reflectFindings", () => {
  it("fail-open keeps findings when LLM errors", async () => {
    const { findings, warnings } = await reflectFindings({
      findings: [
        {
          path: "a.ts",
          content: "x",
          existingCode: "y",
          category: "other",
          severity: "low",
          anchored: false,
        },
      ],
      files: [],
      llm: {
        complete: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(findings).toHaveLength(1);
    expect(warnings.some((w) => w.code === "reflect_skipped")).toBe(true);
  });
});

describe("exportSarif", () => {
  it("emits empty results array and Mitii tool name", () => {
    const pipeline = new ReviewPipeline();
    const preview = pipeline.preview({
      schemaVersion: 1,
      files: [],
    });
    void preview;
    const result = {
      schemaVersion: 1 as const,
      status: "ok" as const,
      mode: "workspace" as const,
      effort: "medium" as const,
      files: [],
      groups: [],
      findings: [],
      selectedCount: 0,
      excludedCount: 0,
      findingCount: 0,
      anchoredCount: 0,
      reasonCodes: ["review_complete" as const],
      warnings: [],
    };
    const sarif = exportSarif({ result });
    expect(sarif.runs[0]?.results).toEqual([]);
    expect(sarif.runs[0]?.tool.driver.name).toBe(REVIEW_SARIF_TOOL_NAME);
  });
});

describe("ReviewPipeline", () => {
  it("preview selection matches prepare selection", () => {
    const pipeline = new ReviewPipeline();
    const input = {
      schemaVersion: 1 as const,
      files: [
        { path: "src/a.ts", diff: "+const a = 1;\n", insertions: 1 },
        { path: "node_modules/x.js", diff: "+1\n", insertions: 1 },
      ],
    };
    const preview = pipeline.preview(input);
    const prep = pipeline.prepare(input);
    expect(preview.files.map((f) => f.excludeReason)).toEqual(
      prep.files.map((f) => f.excludeReason),
    );
    expect(preview.selectedCount).toBe(prep.selectedCount);
  });

  it("finalize persists a ReviewRecord", async () => {
    const store = new InMemoryReviewRecordStore();
    const pipeline = new ReviewPipeline({
      records: store,
      idGenerator: () => "rec-1",
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const input = {
      schemaVersion: 1 as const,
      workspaceId: "ws-1",
      files: [
        {
          path: "src/a.ts",
          diff: "",
          content: "const x = 1;\n",
          insertions: 1,
        },
      ],
    };
    const result = await pipeline.finalize({
      input,
      findings: [
        {
          path: "src/a.ts",
          content: "name x better",
          existingCode: "const x = 1;",
          category: "style",
          severity: "low",
          anchored: false,
        },
      ],
    });
    expect(result.recordId).toBe("rec-1");
    expect(result.anchoredCount).toBe(1);
    const latest = await pipeline.loadLatest("ws-1");
    expect(latest?.recordId).toBe("rec-1");
    expect(latest?.schemaVersion).toBe("mitii.review/v1");
  });
});
