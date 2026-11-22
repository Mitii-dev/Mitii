import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  MUTATION_TOOL_IDS,
  ToolRuntimePipeline,
  directory,
  file,
} from "../../index";
import type { ToolGrant } from "../../../../modules/decision-policy";
import { createReadOnlyGrant } from "./grants";

export const WORKSPACE = "/workspace";

export function createWriteGrant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: [
      ...createReadOnlyGrant().allowedTools,
      ...MUTATION_TOOL_IDS,
    ],
    allowedEffects: [
      "workspace_read",
      "workspace_write",
      "process_execute",
    ],
    pathScopes: ["."],
    approvalMode: "when_required",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    ...overrides,
  };
}

export function createRuntime(root = directory({ "src": directory({ "a.ts": file("const x = 1;\n") }) })) {
  return {
    fs: new InMemoryFileSystemAdapter(WORKSPACE, root),
    runtime: new ToolRuntimePipeline({
      fileSystem: new InMemoryFileSystemAdapter(WORKSPACE, root),
      process: new InMemoryProcessAdapter(async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        truncated: false,
      })),
    }),
  };
}
