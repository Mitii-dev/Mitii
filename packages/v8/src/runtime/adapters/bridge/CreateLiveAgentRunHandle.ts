import type {
  AgentRunHandle,
  AgentRunResult,
} from "../../../engine/v8-engine/contracts";
import type { RuntimePipeline } from "../../flow/Pipeline";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";
import type { RuntimeResumeInput } from "../../contracts/input/RuntimeResumeInput";
import { RuntimeEventChannel } from "../../helpers/events/RuntimeEventChannel";
import type { RuntimeBridgeSkipPhase } from "./BuildRuntimeBridgeEvents";
import { createAgentRunHandleFromRuntimeResult } from "./AgentRunHandleFromRuntimeResult";

const LIVE_SKIP: RuntimeBridgeSkipPhase[] = [
  "decided",
  "context_ready",
  "prompt_ready",
  "verifying",
];

/**
 * Start RuntimePipeline with a live event channel — consumers read stages
 * while the pump is still running, then receive remaining bridge + terminal.
 */
export function createLiveAgentRunHandleFromRuntimeStart(params: {
  runtime: RuntimePipeline;
  start: RuntimeStartInput;
  mode?: "ask" | "plan" | "agent";
  runId: string;
}): AgentRunHandle {
  const channel = new RuntimeEventChannel();
  const abort = new AbortController();

  const pending = (async (): Promise<AgentRunResult> => {
    try {
      const result = await params.runtime.start({
        start: params.start,
        mode: params.mode,
        runId: params.runId,
        eventSink: channel,
        abortSignal: abort.signal,
      });
      if (abort.signal.aborted && result.status === "completed") {
        const cancelled = createAgentRunHandleFromRuntimeResult({
          ...result,
          status: "cancelled",
          reasonCodes: [...result.reasonCodes, "runtime_cancelled"],
        });
        for await (const event of cancelled.events) {
          channel.push(event);
        }
        channel.end();
        return cancelled.result;
      }
      const handle = createAgentRunHandleFromRuntimeResult(result, {
        skipPhases: LIVE_SKIP,
      });
      for await (const event of handle.events) {
        channel.push(event);
      }
      channel.end();
      return handle.result;
    } catch (error) {
      if (abort.signal.aborted) {
        channel.end();
        const cancelled = createAgentRunHandleFromRuntimeResult({
          schemaVersion: 1,
          runId: params.runId,
          status: "cancelled",
          reasonCodes: ["runtime_cancelled"],
        });
        return cancelled.result;
      }
      channel.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  })();

  return {
    runId: params.runId,
    events: channel.events(),
    result: pending,
    cancel() {
      abort.abort();
    },
  };
}

/** Resume with the same live channel pattern. */
export function createLiveAgentRunHandleFromRuntimeResume(params: {
  runtime: RuntimePipeline;
  resume: RuntimeResumeInput & {
    message?: string;
    mode?: "ask" | "plan" | "agent";
  };
}): AgentRunHandle {
  const channel = new RuntimeEventChannel();
  const abort = new AbortController();

  const pending = (async (): Promise<AgentRunResult> => {
    try {
      const result = await params.runtime.resume({
        ...params.resume,
        eventSink: channel,
        abortSignal: abort.signal,
      });
      const handle = createAgentRunHandleFromRuntimeResult(result, {
        skipPhases: LIVE_SKIP,
      });
      for await (const event of handle.events) {
        channel.push(event);
      }
      channel.end();
      return handle.result;
    } catch (error) {
      channel.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  })();

  return {
    runId: params.resume.runId,
    events: channel.events(),
    result: pending,
    cancel() {
      abort.abort();
    },
  };
}
