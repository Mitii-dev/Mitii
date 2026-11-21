import { describe, expect, it } from "vitest";

import { V8EnginePipeline } from "./V8EnginePipeline";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "../tests/fixtures/stubs";

const startInput = {
  schemaVersion: 1 as const,
  workspaceRoot: "/repo",
  request: {
    sessionId: "sess_vm",
    mode: "agent" as const,
    userMessage: "Fix src/auth/login.spec.ts — apply_patch only that file.",
    workspace: { workspaceId: "ws_vm" },
    requestId: "req_vm_1",
  },
};

const patchCall = {
  id: "call_patch",
  name: "apply_patch",
  arguments: JSON.stringify({
    patches: [
      { path: "src/auth/login.spec.ts", oldText: "old", newText: "new" },
    ],
  }),
};

const verifyCall = {
  id: "call_verify",
  name: "run_readonly_command",
  arguments: JSON.stringify({ argv: ["pnpm", "test"] }),
};

function engineWith(verifyExitCode: number, llm: ScriptedLlmPort) {
  return new V8EnginePipeline(
    createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["apply_patch", "run_readonly_command"],
          allowedEffects: ["workspace_write", "process_read"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm,
      toolResults: {
        apply_patch: {
          status: "succeeded",
          output: {
            checkpointId: "cp_vm_1",
            changedFiles: ["src/auth/login.spec.ts"],
          },
        },
        run_readonly_command: {
          status: "succeeded",
          output: { argv: ["pnpm", "test"], exitCode: verifyExitCode },
        },
      },
    }),
  );
}

describe("model loop finish after verified mutation", () => {
  it("does not start another model turn once verification passed after an edit", async () => {
    const llm = new ScriptedLlmPort([
      { content: "Applying the fix.", toolCalls: [patchCall] },
      { content: "Running tests.", toolCalls: [verifyCall] },
      { content: "Extra free-form narration that should never be requested." },
    ]);
    const result = await engineWith(0, llm).start(startInput).result;

    expect(llm.requests).toHaveLength(2);
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("loop_finished_after_verified_mutation");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.answer ?? "").not.toContain("Extra free-form");
  });

  it("keeps the model turn when the verification command failed", async () => {
    const llm = new ScriptedLlmPort([
      { content: "Applying the fix.", toolCalls: [patchCall] },
      { content: "Running tests.", toolCalls: [verifyCall] },
      { content: "Tests failed; here is the status." },
    ]);
    const result = await engineWith(1, llm).start(startInput).result;

    expect(llm.requests.length).toBeGreaterThanOrEqual(3);
    expect(result.reasonCodes).not.toContain(
      "loop_finished_after_verified_mutation",
    );
  });
});
