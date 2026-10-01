/**
 * Phase 7 goldens — T10 rejected mutation, T11 prepareTurn wire,
 * T12 soft must-read budget.
 */
import { describe, expect, it } from "vitest";

import {
  allowsTargetedDiscoveryAfterRejectedMutation,
  buildRejectedMutationRecoveryMessage,
} from "../actions/rejectedMutationRecovery";
import {
  resolveV8EngineThresholds,
  V8_ENGINE_THRESHOLDS,
} from "../policy";
import { resolveV8LoopPolicyThresholds } from "../policy/bands";
import { V8EnginePipeline } from "../pipeline/V8EnginePipeline";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "../tests/fixtures/stubs";

describe("v8-engine golden T10 — rejected mutation recovery", () => {
  it("ships a soft recovery budget separate from unfulfilled-execute", () => {
    expect(V8_ENGINE_THRESHOLDS.maxRejectedMutationRecoveries).toBeGreaterThan(
      0,
    );
    const resolved = resolveV8EngineThresholds();
    expect(resolved.maxRejectedMutationRecoveries).toBe(
      V8_ENGINE_THRESHOLDS.maxRejectedMutationRecoveries,
    );
  });

  it("recovery copy steers to corrected apply_patch after stale hunk", () => {
    const message = buildRejectedMutationRecoveryMessage({
      toolName: "apply_patch",
      status: "rejected",
      reasonCode: "invalid_arguments",
      warnings: ["oldText not found in file"],
      summary: "patches=1 paths=src/auth/login.ts",
      maxTargetedDiscoveryToolCalls: 4,
      defaultPreferredBatchSize: V8_ENGINE_THRESHOLDS.preferredBatchSize,
    });
    expect(message).toContain("apply_patch");
    expect(message).toMatch(/corrected|oldText|currentContent/i);
    expect(
      allowsTargetedDiscoveryAfterRejectedMutation({
        toolName: "apply_patch",
        reasonCode: "invalid_arguments",
        warnings: ["oldText not found"],
      }),
    ).toBe(true);
  });

  it("recovery copy steers after patch_syntax_invalid and change_impact_incomplete", () => {
    const syntax = buildRejectedMutationRecoveryMessage({
      toolName: "apply_patch",
      status: "rejected",
      reasonCode: "patch_syntax_invalid",
      warnings: ["Bracket imbalance after patch"],
      summary: "patches=1 paths=src/a.ts",
      maxTargetedDiscoveryToolCalls: 4,
      defaultPreferredBatchSize: V8_ENGINE_THRESHOLDS.preferredBatchSize,
    });
    expect(syntax).toMatch(/syntax check|bracket balance/i);
    expect(syntax).toMatch(/smaller exact oldText/i);

    const impact = buildRejectedMutationRecoveryMessage({
      toolName: "apply_patch",
      status: "rejected",
      reasonCode: "change_impact_incomplete",
      warnings: ["analyze_change_impact is required"],
      summary: "patches=1 paths=src/a.ts",
      maxTargetedDiscoveryToolCalls: 4,
      defaultPreferredBatchSize: V8_ENGINE_THRESHOLDS.preferredBatchSize,
    });
    expect(impact).toContain("analyze_change_impact");
    expect(impact).toMatch(/retry the same apply_patch/i);
  });

  it("retries apply_patch after a rejected stale hunk instead of giving up", async () => {
    let applyCalls = 0;
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["apply_patch", "read_file"],
          allowedEffects: ["workspace_write", "workspace_read"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort([
        {
          content: "",
          toolCalls: [
            {
              id: "bad_patch",
              name: "apply_patch",
              arguments: JSON.stringify({
                patches: [
                  {
                    path: "src/auth/login.ts",
                    oldText: "stale",
                    newText: "fixed",
                  },
                ],
              }),
            },
          ],
        },
        {
          content: "",
          toolCalls: [
            {
              id: "good_patch",
              name: "apply_patch",
              arguments: JSON.stringify({
                patches: [
                  {
                    path: "src/auth/login.ts",
                    oldText: "current",
                    newText: "fixed",
                  },
                ],
              }),
            },
          ],
        },
        { content: "Patched login." },
      ]),
    });
    deps.tools = {
      execute: async (input) => {
        if (input.toolName === "apply_patch") {
          applyCalls += 1;
          if (applyCalls === 1) {
            return {
              schemaVersion: 1,
              callId: input.callId,
              toolName: input.toolName,
              status: "rejected",
              reasonCode: "invalid_arguments",
              truncated: false,
              redacted: false,
              durationMs: 1,
              bytesProduced: 0,
              warnings: ["oldText not found in file"],
              output: { currentContent: "current line" },
              audit: {
                callId: input.callId,
                toolName: input.toolName,
                startedAt: "2026-07-25T12:00:00.000Z",
                endedAt: "2026-07-25T12:00:00.001Z",
                status: "rejected",
                inputPreview: "{}",
                outputPreview: "{}",
                bytesProduced: 0,
                durationMs: 1,
                truncated: false,
                redacted: false,
              },
            };
          }
          return {
            schemaVersion: 1,
            callId: input.callId,
            toolName: input.toolName,
            status: "succeeded",
            truncated: false,
            redacted: false,
            durationMs: 1,
            bytesProduced: 12,
            warnings: [],
            output: {
              checkpointId: "cp_t10",
              changedFiles: ["src/auth/login.ts"],
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "succeeded",
              inputPreview: "{}",
              outputPreview: '{"ok":true}',
              bytesProduced: 12,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return {
          schemaVersion: 1,
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          truncated: false,
          redacted: false,
          durationMs: 1,
          bytesProduced: 12,
          warnings: [],
          output: { ok: true },
          audit: {
            callId: input.callId,
            toolName: input.toolName,
            startedAt: "2026-07-25T12:00:00.000Z",
            endedAt: "2026-07-25T12:00:00.001Z",
            status: "succeeded",
            inputPreview: "{}",
            outputPreview: '{"ok":true}',
            bytesProduced: 12,
            durationMs: 1,
            truncated: false,
            redacted: false,
          },
        };
      },
    };

    const engine = new V8EnginePipeline(deps);

    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "sess_t10",
        mode: "agent",
        userMessage: "Fix src/auth/login.ts with apply_patch.",
        workspace: { workspaceId: "ws_t10" },
      },
      workspaceRoot: "/workspace",
    }).result;

    expect(applyCalls).toBeGreaterThanOrEqual(2);
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("tool_failed");
  });
});

describe("v8-engine golden T11 — prepareTurn wired", () => {
  it("resolves loop thresholds including compaction-related ship knobs", () => {
    const resolved = resolveV8LoopPolicyThresholds({
      contextWindowTokens: 80_000,
    });
    expect(resolved.thresholds.maxTruncationRecoveries).toBeGreaterThan(0);
    expect(resolved.band).toBe("standard");
  });

  it("long execute still completes with tools after multiple turns", async () => {
    const engine = new V8EnginePipeline(
      createStubDependencies({
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
        llm: new ScriptedLlmPort([
          {
            content: "",
            toolCalls: [
              {
                id: "r1",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/a.ts" }),
              },
            ],
          },
          {
            content: "",
            toolCalls: [
              {
                id: "r2",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/b.ts" }),
              },
            ],
          },
          {
            content: "",
            toolCalls: [
              {
                id: "p1",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    { path: "src/a.ts", oldText: "x", newText: "y" },
                  ],
                }),
              },
            ],
          },
          { content: "Done after reads." },
        ]),
        toolResults: {
          read_file: {
            status: "succeeded",
            output: { content: "file body ".repeat(40) },
          },
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_t11",
              changedFiles: ["src/a.ts"],
            },
          },
        },
      }),
    );

    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "sess_t11",
        mode: "agent",
        userMessage: "Read src/a.ts and src/b.ts then patch a.ts.",
        workspace: { workspaceId: "ws_t11" },
      },
      workspaceRoot: "/workspace",
    }).result;

    expect(result.status).toBe("completed");
    expect(result.usage.modelCalls).toBeGreaterThanOrEqual(3);
    expect(result.usage.toolCalls).toBeGreaterThanOrEqual(3);
  });
});

describe("v8-engine golden T12 — soft must-read nudge budget", () => {
  it("ships maxMustReadNudges > 0 (soft, not evidence-spend lock)", () => {
    expect(V8_ENGINE_THRESHOLDS.maxMustReadNudges).toBeGreaterThan(0);
    expect(
      resolveV8EngineThresholds().maxMustReadNudges,
    ).toBeGreaterThan(0);
  });

  it("withholds first patch when mustRead paths are unread, then allows retry", async () => {
    const engine = new V8EnginePipeline(
      createStubDependencies({
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
        llm: new ScriptedLlmPort([
          {
            content: "",
            toolCalls: [
              {
                id: "early_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/auth/session.ts",
                      oldText: "type Session = string",
                      newText: "type Session = object",
                    },
                  ],
                }),
              },
            ],
          },
          {
            content: "",
            toolCalls: [
              {
                id: "read_types",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/auth/types.ts" }),
              },
              {
                id: "real_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/auth/session.ts",
                      oldText: "type Session = string",
                      newText: "type Session = object",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Patched after mustRead." },
        ]),
        toolResults: {
          read_file: {
            status: "succeeded",
            output: { content: "export type Auth = {};" },
          },
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_t12",
              changedFiles: ["src/auth/session.ts"],
            },
          },
        },
      }),
    );

    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "sess_t12",
        mode: "agent",
        userMessage: "Fix the session type error",
        workspace: { workspaceId: "ws_t12" },
      },
      workspaceRoot: "/repo",
      taskList: {
        schemaVersion: 1,
        source: "plan",
        purpose: "execution",
        items: [
          {
            id: "fix",
            title: "Change: Fix src/auth/session.ts",
            status: "active",
            write: ["src/auth/session.ts"],
            mustRead: ["src/auth/types.ts"],
          },
        ],
      },
    }).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("must_read_nudged");
  });
});
