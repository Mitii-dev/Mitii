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
});
