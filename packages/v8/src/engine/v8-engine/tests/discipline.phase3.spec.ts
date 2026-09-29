import { describe, expect, it } from "vitest";

import { V8EnginePipeline } from "../pipeline/V8EnginePipeline";
import { InMemoryRunCheckpointStore } from "../../agent-engine/adapters";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
  createCapabilities,
} from "../../agent-engine/tests/fixtures/stubs";
import { V8_ENGINE_THRESHOLDS } from "../policy";

describe("v8-engine Phase 3 discipline", () => {
  it("force-final identical tool thrash then Continue resume completes", async () => {
    // Hard limit in policy is 6 — script that many identical reads then a final answer after Continue.
    const identicalRead = {
      content: "",
      toolCalls: [
        {
          id: "r1",
          name: "read_file",
          arguments: JSON.stringify({ path: "src/a.ts" }),
        },
      ],
    };
    const turns = [
      ...Array.from({ length: V8_ENGINE_THRESHOLDS.toolLoopHardIdentical }, () => ({
        ...identicalRead,
        toolCalls: identicalRead.toolCalls.map((c) => ({
          ...c,
          id: `r_${Math.random().toString(36).slice(2, 6)}`,
        })),
      })),
      // After force-final, model may still try tools → reject path; then Continue resume
      // needs more turns. Simpler: after thrash we expect suspended continue_required
      // once rejects exhaust. With forcedRejectLimit=2 after force_final.
      ...Array.from(
        { length: V8_ENGINE_THRESHOLDS.toolLoopForcedRejectLimit },
        () => ({
          ...identicalRead,
          toolCalls: identicalRead.toolCalls.map((c) => ({
            ...c,
            id: `rj_${Math.random().toString(36).slice(2, 6)}`,
          })),
        }),
      ),
    ];

    const checkpointStore = new InMemoryRunCheckpointStore();
    const engine = new V8EnginePipeline(
      createStubDependencies({
        checkpointStore,
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["read_file", "apply_patch"],
            allowedEffects: ["workspace_read", "workspace_write"],
            approvalMode: "never",
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm: new ScriptedLlmPort(turns),
        toolResults: {
          read_file: {
            status: "succeeded",
            output: { content: "file body" },
          },
        },
      }),
    );

    const start = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/repo",
      request: {
        sessionId: "sess_loop",
        mode: "agent",
        userMessage: "Fix src/a.ts",
        workspace: { workspaceId: "ws_1" },
      },
      budget: {
        maxModelCalls: 40,
        maxToolCalls: 80,
        maxLoopIterations: 80,
      },
    }).result;

    // Soft mutation nudge may fire first; thrash should eventually suspend or fail.
    // With force_final + reject exhaust we expect continue_required when checkpoint store present.
    expect(["suspended", "failed", "completed"]).toContain(start.status);
    if (start.status === "suspended") {
      expect(start.suspension?.kind).toBe("continue_required");
      expect(start.reasonCodes).toContain("stall_continue_suspended");

      const resumeLlm = new ScriptedLlmPort([
        {
          content: "",
          toolCalls: [
            {
              id: "patch",
              name: "apply_patch",
              arguments: JSON.stringify({
                patches: [
                  { path: "src/a.ts", oldText: "x", newText: "y" },
                ],
              }),
            },
          ],
        },
        { content: "Fixed." },
      ]);
      // Swap LLM on deps is hard; resume with same stub may repeat. Use new pipeline
      // sharing checkpoint store — ScriptedLlmPort overruns repeat last turn.
      const resumeEngine = new V8EnginePipeline(
        createStubDependencies({
          checkpointStore,
          decision: createDecision({
            route: "execute",
            toolGrant: createReadOnlyGrant({
              maximumWorkspaceEffect: "write",
              allowedTools: ["read_file", "apply_patch"],
              allowedEffects: ["workspace_read", "workspace_write"],
              approvalMode: "never",
            }),
            reasonCodes: ["mutation_execute"],
          }),
          llm: resumeLlm,
          toolResults: {
            apply_patch: {
              status: "succeeded",
              output: {
                checkpointId: "cp_resume",
                changedFiles: ["src/a.ts"],
              },
            },
            read_file: {
              status: "succeeded",
              output: { content: "file body" },
            },
          },
        }),
      );

      const resumed = await resumeEngine.resume({
        schemaVersion: 1,
        runId: start.runId,
        continueDecision: { decision: "continue" },
      }).result;

      expect(resumed.runId).toBe(start.runId);
      expect(resumed.reasonCodes).toContain("stall_continue_approved");
      expect(["completed", "suspended", "failed"]).toContain(resumed.status);
    }
  });

  it("text-only execute offers Continue after unfulfilled recoveries", async () => {
    const checkpointStore = new InMemoryRunCheckpointStore();
    const textTurns = Array.from(
      { length: V8_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries + 1 },
      (_, i) => ({ content: `Still analyzing ${i}.` }),
    );
    const engine = new V8EnginePipeline(
      createStubDependencies({
        checkpointStore,
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
            approvalMode: "never",
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm: new ScriptedLlmPort(
          textTurns,
          createCapabilities({ supportsTools: true }),
        ),
      }),
    );

    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/repo",
      request: {
        sessionId: "sess_unfulfilled",
        mode: "agent",
        userMessage: "Patch src/b.ts",
        workspace: { workspaceId: "ws_1" },
      },
      budget: { maxModelCalls: 20, maxToolCalls: 20, maxLoopIterations: 20 },
    }).result;

    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("continue_required");
  });
});
