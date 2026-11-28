import { describe, expect, it } from "vitest";

import { composeRuntime } from "../../adapters/compose/ComposeRuntime";
import { scriptedModelPort } from "../../adapters/model/ScriptedModelPort";
import { executeViaCallback } from "../../adapters/tools/ExecuteViaCallback";
import { EchoLlmPort } from "../../../modules/model-gateway";
import { completeViaLlmPort } from "../../adapters/model/CompleteViaLlmPort";

describe("turn loop with model/tool ports", () => {
  it("runs scripted model + grant-gated tools", async () => {
    const executed: string[] = [];
    const runtime = composeRuntime({
      model: scriptedModelPort([
        {
          text: "",
          toolCalls: [
            { callId: "c1", toolId: "read_file", args: { path: "a.ts" } },
            { callId: "c2", toolId: "apply_patch", args: {} },
          ],
          reasonCodes: ["scripted_tools"],
        },
        {
          text: "done",
          toolCalls: [],
          reasonCodes: ["scripted_done"],
        },
      ]),
      tools: executeViaCallback(async ({ toolId }) => {
        executed.push(toolId);
        return { ok: true, output: { toolId } };
      }),
    });

    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "ports-1",
    });

    expect(result.status).toBe("completed");
    expect(executed).toContain("read_file");
    expect(executed).not.toContain("apply_patch");
    expect(result.reasonCodes.some((c) => c.includes("turn_loop") || c.includes("scripted"))).toBe(
      true,
    );
  });

  it("adapts EchoLlmPort and completes without tools", async () => {
    const runtime = composeRuntime({
      model: completeViaLlmPort(new EchoLlmPort()),
    });
    const result = await runtime.start({
      start: { message: "what is 2+2 in general?" },
      mode: "ask",
      runId: "ports-2",
    });
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("runtime_start_completed");
    expect(result.answer).toContain("Echo:");
  });

  it("recovers JSON-leaked tool calls and continues the loop", async () => {
    const executed: string[] = [];
    let turn = 0;
    const runtime = composeRuntime({
      model: {
        async complete() {
          turn += 1;
          if (turn === 1) {
            // gpt-oss often leaks tool intent as JSON text (not tool_call events).
            return {
              text: '{"tool":"read_file","arguments":{"path":"README.md"}}',
              toolCalls: [],
              reasonCodes: ["scripted_json_leak"],
            };
          }
          return {
            text: "README describes the project.",
            toolCalls: [],
            reasonCodes: ["scripted_after_leak"],
          };
        },
      },
      tools: executeViaCallback(async ({ toolId }) => {
        executed.push(toolId);
        return {
          ok: true,
          output: { path: "README.md", content: "# Mitii" },
        };
      }),
    });

    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "ports-leak",
    });

    expect(result.status).toBe("completed");
    expect(executed).toContain("read_file");
    expect(result.answer).toMatch(/README describes the project/i);
    expect(
      result.reasonCodes.some(
        (c) =>
          c.includes("turn_loop_recovered_leaked") ||
          c.includes("scripted_after_leak"),
      ),
    ).toBe(true);
  });

  it("feeds tool results into the next model turn", async () => {
    const seenSecondTurn: string[] = [];
    let sawAssistantToolCalls = false;
    const runtime = composeRuntime({
      model: {
        async complete(request) {
          const toolMsgs = request.messages.filter((m) => m.role === "tool");
          if (toolMsgs.length === 0) {
            return {
              text: "We need to call read_file.",
              toolCalls: [
                {
                  callId: "r1",
                  toolId: "read_file",
                  args: { path: "README.md" },
                },
              ],
              reasonCodes: ["scripted_need_read"],
            };
          }
          const assistantWithTools = [...request.messages]
            .reverse()
            .find((m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0);
          sawAssistantToolCalls = Boolean(assistantWithTools);
          seenSecondTurn.push(...toolMsgs.map((m) => m.content));
          return {
            text: `README says: ${toolMsgs[0]?.content ?? ""}`,
            toolCalls: [],
            reasonCodes: ["scripted_after_tool"],
          };
        },
      },
      tools: executeViaCallback(async () => ({
        ok: true,
        output: { path: "README.md", content: "# Mitii bench" },
      })),
    });

    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "ports-3",
    });

    expect(result.status).toBe("completed");
    expect(sawAssistantToolCalls).toBe(true);
    expect(seenSecondTurn.length).toBeGreaterThan(0);
    expect(seenSecondTurn[0]).toMatch(/Mitii bench|README|ok/i);
    expect(result.answer).toMatch(/README|Mitii bench/i);
    expect(result.answer).not.toMatch(/We need to call/i);
  });

  it("streams model_delta and model_turn with tokens through the event sink", async () => {
    const events: Array<{ type: string; kind?: string; inputTokens?: number }> =
      [];
    const runtime = composeRuntime({
      model: {
        async complete(_request, options) {
          options?.onEvent?.({
            type: "reasoning_delta",
            reasoning: "inspecting repo",
          });
          options?.onEvent?.({
            type: "content_delta",
            content: "Mitii bench is a benchmark suite.",
          });
          return {
            text: "Mitii bench is a benchmark suite.",
            toolCalls: [],
            reasonCodes: ["scripted_stream"],
            usage: { inputTokens: 42, outputTokens: 18 },
            finishReason: "stop",
          };
        },
      },
    });

    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "ports-stream",
      eventSink: {
        push(event) {
          events.push({
            type: event.type,
            ...("kind" in event && typeof event.kind === "string"
              ? { kind: event.kind }
              : {}),
            ...("inputTokens" in event &&
            typeof event.inputTokens === "number"
              ? { inputTokens: event.inputTokens }
              : {}),
          });
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("runtime_live_model_events");
    expect(result.usage?.inputTokens).toBe(42);
    expect(result.usage?.outputTokens).toBe(18);
    expect(result.usage?.modelCalls).toBeGreaterThanOrEqual(1);
    expect(
      events.some((e) => e.type === "model_delta" && e.kind === "reasoning"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "model_delta" && e.kind === "content"),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "model_turn" && e.inputTokens === 42),
    ).toBe(true);
  });

  it("does not finish with co-emitted tool-turn prose when follow-up is empty", async () => {
    const runtime = composeRuntime({
      model: {
        async complete(request) {
          const lastUser = [...request.messages]
            .reverse()
            .find((m) => m.role === "user");
          if (
            request.tools.length === 0 &&
            /Stop calling tools/i.test(lastUser?.content ?? "")
          ) {
            return {
              text: "StoreManager holds run slices for the runtime pump.",
              toolCalls: [],
              reasonCodes: ["scripted_forced_final"],
            };
          }
          const toolMsgs = request.messages.filter((m) => m.role === "tool");
          if (toolMsgs.length === 0) {
            return {
              text: "We need to call list_directory for packages.",
              toolCalls: [
                {
                  callId: "d1",
                  toolId: "list_directory",
                  args: { path: "." },
                },
              ],
              reasonCodes: ["scripted_mid_reason"],
            };
          }
          return {
            text: "",
            toolCalls: [],
            reasonCodes: ["scripted_empty_followup"],
          };
        },
      },
      tools: executeViaCallback(async () => ({
        ok: true,
        output: { entries: ["packages", "README.md"] },
      })),
    });

    const result = await runtime.start({
      start: {
        message: "how does packages/v8/src/runtime StoreManager work?",
      },
      mode: "ask",
      runId: "ports-no-mid-reason",
    });

    expect(result.status).toBe("completed");
    expect(result.answer ?? "").not.toMatch(/We need to call/i);
    expect(result.answer).toMatch(/StoreManager/i);
    expect(result.reasonCodes).toContain("turn_loop_forced_final_answer");
  });

  it("nudges agent execute toward apply_patch after read-only thrash", async () => {
    const executed: string[] = [];
    let sawMutationNudge = false;
    let readTurns = 0;
    const runtime = composeRuntime({
      model: {
        async complete(request) {
          if (request.tools.length === 0 && request.messages.length <= 2) {
            return {
              text: JSON.stringify({
                schemaVersion: 1,
                primaryTaskIntent: "implementation",
                interactionIntent: "request",
                difficulty: "simple",
                taskBand: "small",
                risk: "low",
                scope: "repo",
                planningHint: "none",
                clarityConfidence: "high",
                askUserSuggested: false,
                reasonCodes: ["scripted_assess"],
              }),
              toolCalls: [],
              reasonCodes: ["scripted_assess"],
            };
          }
          const lastUser = [...request.messages]
            .reverse()
            .find((m) => m.role === "user");
          const nudged =
            /apply_patch|workspace edit|MUTATION REQUIRED|read-only tool turns/i.test(
              lastUser?.content ?? "",
            );
          if (nudged) {
            sawMutationNudge = true;
            return {
              text: "",
              toolCalls: [
                {
                  callId: "p1",
                  toolId: "apply_patch",
                  args: { path: "README.md" },
                },
              ],
              reasonCodes: ["scripted_patch_after_nudge"],
            };
          }
          readTurns += 1;
          return {
            text: "",
            toolCalls: [
              {
                callId: `r${readTurns}`,
                toolId: "read_file",
                args: { path: "README.md" },
              },
            ],
            reasonCodes: ["scripted_read"],
          };
        },
      },
      tools: executeViaCallback(async ({ toolId }) => {
        executed.push(toolId);
        return { ok: true, output: { content: "# mitii-bench" } };
      }),
    });

    const result = await runtime.start({
      start: {
        message: "rewrite README.md to document the full project layout",
        approvalMode: "every_mutation",
      },
      mode: "agent",
      runId: "ports-mutate-nudge",
    });

    expect(sawMutationNudge).toBe(true);
    expect(
      result.reasonCodes.some(
        (c) =>
          c === "turn_loop_soft_mutation_nudge" ||
          c === "turn_loop_mutation_nudge",
      ),
    ).toBe(true);
    expect(result.reasonCodes).toContain("turn_loop_max_12");
    expect(result.status).toBe("suspended");
    expect(result.gateKind).toBe("mutation_approval_required");
    expect(executed).not.toContain("apply_patch");
  });

  it("emits tool path summaries on live tool events", async () => {
    const events: Array<{
      type: string;
      toolName?: string;
      summary?: string;
      status?: string;
    }> = [];
    const runtime = composeRuntime({
      model: {
        async complete(request) {
          // Direction assess consumes one model call with tools:[].
          if (request.tools.length === 0 && request.messages.length <= 2) {
            return {
              text: JSON.stringify({
                schemaVersion: 1,
                primaryTaskIntent: "question",
                interactionIntent: "question",
                difficulty: "simple",
                taskBand: "small",
                risk: "low",
                scope: "unknown",
                planningHint: "none",
                clarityConfidence: "high",
                askUserSuggested: false,
                reasonCodes: ["scripted_assess"],
              }),
              toolCalls: [],
              reasonCodes: ["scripted_assess"],
            };
          }
          if (
            request.messages.every(
              (m) => m.role !== "tool" && !(m.toolCalls?.length),
            )
          ) {
            return {
              text: "",
              toolCalls: [
                {
                  callId: "g1",
                  toolId: "glob_files",
                  args: { pattern: "**/*.ts", path: "packages" },
                },
              ],
              reasonCodes: ["scripted_glob"],
            };
          }
          return {
            text: "Found TypeScript sources under packages.",
            toolCalls: [],
            reasonCodes: ["scripted_done"],
          };
        },
      },
      tools: executeViaCallback(async () => ({
        ok: false,
        reasonCode: "path_not_found",
      })),
    });

    const result = await runtime.start({
      start: { message: "where are the TypeScript sources?" },
      mode: "ask",
      runId: "ports-tool-summary",
      eventSink: {
        push(event) {
          if (event.type === "tool_started" || event.type === "tool_completed") {
            events.push({
              type: event.type,
              toolName: event.toolName,
              ...("summary" in event && typeof event.summary === "string"
                ? { summary: event.summary }
                : {}),
              ...("status" in event && typeof event.status === "string"
                ? { status: event.status }
                : {}),
            });
          }
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(events.map((e) => e.type)).toContain("tool_started");
    const started = events.find((e) => e.type === "tool_started");
    expect(started).toEqual(
      expect.objectContaining({
        toolName: "glob_files",
        summary: expect.stringMatching(/pattern=\*\*\/\*\.ts/),
      }),
    );
    expect(started?.summary).toMatch(/path=packages/);
    const completed = events.find((e) => e.type === "tool_completed");
    expect(completed?.status).toBe("failed");
    expect(completed?.summary).toMatch(/pattern=/);
    expect(result.toolInvocations?.[0]?.summary).toMatch(/pattern=/);
  });
});
