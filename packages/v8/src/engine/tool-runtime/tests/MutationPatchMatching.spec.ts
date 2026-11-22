import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  ToolRuntimePipeline,
  directory,
  file,
  isPatchCurrentContentReason,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";
import {
  WORKSPACE,
  createRuntime,
  createWriteGrant,
} from "./fixtures/mutationRuntime";

describe("Tool Runtime mutations: replaceAll, create and fuzzy match", () => {
  it("replaces every exact occurrence when replaceAll is true", async () => {
    const { runtime, fs } = createRuntime(
      directory({ src: directory({ "a.ts": file("foo\nfoo\n") }) }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m6",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "foo",
            newText: "bar",
            replaceAll: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("bar\nbar\n");
  });

  it("still treats regex-looking oldText as a literal under replaceAll", async () => {
    const { runtime, fs } = createRuntime(
      directory({ src: directory({ "a.ts": file("a.*\na.*\n") }) }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m6b",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "a.*",
            newText: "b",
            replaceAll: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("succeeded");
    const patched = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(patched.content).toBe("b\nb\n");
  });

  it("coerces string replaceAll and keeps unique-match as the default", async () => {
    const { runtime } = createRuntime(
      directory({ src: directory({ "a.ts": file("foo\nfoo\n") }) }),
    );
    const coerced = await runtime.execute({
      schemaVersion: 1,
      callId: "m6c",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "foo",
            newText: "bar",
            replaceAll: "true",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(coerced.status).toBe("succeeded");

    const unique = await runtime.execute({
      schemaVersion: 1,
      callId: "m6d",
      toolName: "apply_patch",
      arguments: {
        patches: [{ path: "src/a.ts", oldText: "bar", newText: "baz" }],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(unique.status).toBe("rejected");
    expect(unique.reasonCode).toBe("old_text_ambiguous");
  });

  it("creates a new file even when diagnostics throw on the missing path", async () => {
    const fs = new InMemoryFileSystemAdapter(
      WORKSPACE,
      directory({ src: directory({ "a.ts": file("const x = 1;\n") }) }),
    );
    const runtime = new ToolRuntimePipeline({
      fileSystem: fs,
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
      diagnostics: {
        async readDiagnostics() {
          throw new Error(
            "Could not find source file: '/workspace/src/about/page.tsx'.",
          );
        },
      },
    });
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "create-new",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/about/page.tsx",
            oldText: "",
            newText:
              'export default function About() {\n  return "About this benchmark app";\n}\n',
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    expect(result.reasonCode).toBeUndefined();
    const written = await fs.readFile(`${WORKSPACE}/src/about/page.tsx`);
    expect(written.content).toContain("About this benchmark app");
  });

  it("rejects replaceAll with empty oldText", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m6e",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "",
            newText: "const y = 1;\n",
            replaceAll: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("invalid_arguments");
  });

  it("rejects destructive empty-oldText wipe of a large existing file", async () => {
    const { runtime, fs } = createRuntime();
    const large = `${"x".repeat(5_000)}\n`;
    await fs.writeFile(`${WORKSPACE}/src/big.ts`, large);
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "wipe-big",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/big.ts",
            oldText: "",
            newText: "// @ts-nocheck\n",
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("patch_too_destructive");
    const still = await fs.readFile(`${WORKSPACE}/src/big.ts`);
    expect(still.content).toBe(large);
  });

  it("rejects write grant without write effect", async () => {
    const { runtime } = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "m5",
      toolName: "apply_patch",
      arguments: {
        patches: [
          { path: "src/a.ts", oldText: "const x = 1;\n", newText: "x" },
        ],
      },
      grant: createReadOnlyGrant({
        allowedTools: ["apply_patch", ...createReadOnlyGrant().allowedTools],
      }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("effect_not_granted");
  });

  it("applies bounded fuzzyMatch when exact oldText is missing", async () => {
    const tree = directory({
      src: directory({
        "a.ts": file("  const x = 1;\n"),
      }),
    });
    const fs = new InMemoryFileSystemAdapter(WORKSPACE, tree);
    const runtime = new ToolRuntimePipeline({
      fileSystem: fs,
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    });
    const args = {
      patches: [
        {
          path: "src/a.ts",
          oldText: "const x = 1;\n",
          newText: "const x = 2;\n",
          fuzzyMatch: true,
        },
      ],
    };
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "fuzzy1",
      toolName: "apply_patch",
      arguments: args,
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("succeeded");
    const written = await fs.readFile(`${WORKSPACE}/src/a.ts`);
    expect(written.content).toContain("const x = 2");
  });

  it("rejects ambiguous fuzzyMatch with patch_fuzzy_ambiguous", async () => {
    const { runtime } = createRuntime(
      directory({
        src: directory({
          "a.ts": file("const x = 1;\nconst y = 1;\nconst x = 1;\n"),
        }),
      }),
    );
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "fuzzy2",
      toolName: "apply_patch",
      arguments: {
        patches: [
          {
            path: "src/a.ts",
            oldText: "  const x = 1;\n",
            newText: "  const x = 2;\n",
            fuzzyMatch: true,
          },
        ],
      },
      grant: createWriteGrant({ approvalMode: "never" }),
      workspaceRoot: WORKSPACE,
    });
    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("patch_fuzzy_ambiguous");
    expect(isPatchCurrentContentReason(result.reasonCode)).toBe(true);
  });
});