import { describe, expect, it } from "vitest";

import {
  ReadLedger,
  buildAlreadyReadToolResult,
} from "../ReadLedger";

describe("ReadLedger", () => {
  it("records and looks up the same path/range", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts", startLine: 1, endLine: 40 },
      preview: "export const a = 1;",
    });

    const hit = ledger.lookup({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts", startLine: 1, endLine: 40 },
    });
    expect(hit?.paths).toEqual(["src/a.ts"]);
    expect(hit?.preview).toContain("export const a");
  });

  it("treats a different line range as a miss", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts", startLine: 1, endLine: 40 },
      preview: "top",
    });
    expect(
      ledger.lookup({
        toolName: "read_file",
        argumentsValue: { path: "src/a.ts", startLine: 41 },
      }),
    ).toBeUndefined();
  });

  it("invalidates only overlapping paths after mutation", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "packages/formik-form-builder/src/index.ts" },
      preview: "formik",
    });
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "packages/mui-builder/src/index.ts" },
      preview: "mui",
    });

    expect(
      ledger.invalidatePaths(["packages/mui-builder/src/index.ts"]),
    ).toBe(1);
    expect(
      ledger.lookup({
        toolName: "read_file",
        argumentsValue: {
          path: "packages/formik-form-builder/src/index.ts",
        },
      })?.preview,
    ).toBe("formik");
    expect(
      ledger.lookup({
        toolName: "read_file",
        argumentsValue: { path: "packages/mui-builder/src/index.ts" },
      }),
    ).toBeUndefined();
  });

  it("supports read_many_files path sets", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_many_files",
      argumentsValue: { paths: ["src/b.ts", "src/a.ts"] },
      preview: "ab",
    });
    expect(
      ledger.lookup({
        toolName: "read_many_files",
        argumentsValue: { paths: ["src/a.ts", "src/b.ts"] },
      })?.preview,
    ).toBe("ab");
  });

  it("ignores non-ledger tools", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "list_directory",
      argumentsValue: { path: "src" },
      preview: "files",
    });
    expect(ledger.size()).toBe(0);
    expect(ReadLedger.isLedgerTool("list_directory")).toBe(false);
    expect(ReadLedger.isLedgerTool("read_file")).toBe(true);
  });

  it("builds a compact already-read tool result", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts" },
      preview: " cons  t x = 1; ",
    });
    const entry = ledger.lookup({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts" },
    });
    const toolResult = buildAlreadyReadToolResult({
      callId: "call_9",
      toolName: "read_file",
      entry: entry!,
      nowIso: "2026-09-04T00:00:00.000Z",
    });
    expect(toolResult.status).toBe("succeeded");
    expect(toolResult.reasonCode).toBe("already_read");
    expect(toolResult.callId).toBe("call_9");
    const output = toolResult.output as { message?: string; alreadyRead?: boolean };
    expect(output.alreadyRead).toBe(true);
    expect(output.message).toContain("Already read");
  });

  it("clear empties the ledger", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts" },
    });
    ledger.clear();
    expect(ledger.size()).toBe(0);
  });

  it("full-wipes when clear is called after path invalidation", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts" },
    });
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/b.ts" },
    });
    expect(ledger.invalidatePaths(["src/a.ts"])).toBe(1);
    expect(ledger.size()).toBe(1);
    ledger.clear();
    expect(ledger.size()).toBe(0);
  });

  it("does not treat a different tool as the same ledger key", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_file",
      argumentsValue: { path: "src/a.ts" },
      preview: "file",
    });
    expect(
      ledger.lookup({
        toolName: "read_many_files",
        argumentsValue: { paths: ["src/a.ts"] },
      }),
    ).toBeUndefined();
  });

  it("invalidates a read_many_files entry when any member path changes", () => {
    const ledger = new ReadLedger();
    ledger.record({
      toolName: "read_many_files",
      argumentsValue: { paths: ["src/a.ts", "src/b.ts"] },
      preview: "ab",
    });
    expect(ledger.invalidatePaths(["src/b.ts"])).toBe(1);
    expect(
      ledger.lookup({
        toolName: "read_many_files",
        argumentsValue: { paths: ["src/a.ts", "src/b.ts"] },
      }),
    ).toBeUndefined();
  });
});
