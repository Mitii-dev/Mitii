import type {
  AgentEngineStartInput,
  AgentRunResult,
} from "../contracts";
import type { V8EngineImplementation } from "../constants";
import {
  composeAgentEngine,
  type ComposeAgentEngineOptions,
} from "./composeAgentEngine";

export type EngineComparePair = {
  implementation: V8EngineImplementation;
  result: AgentRunResult;
  durationMs: number;
};

export type CompareEngineImplementationsResult = {
  legacy: EngineComparePair;
  v8: EngineComparePair;
};

/**
 * Run the same start input twice on v8 (legacy alias removed in Phase 10).
 * Kept for golden harness compatibility — both sides are v8.
 */
export async function compareEngineImplementations(params: {
  createOptions: (
    implementation: V8EngineImplementation,
  ) => ComposeAgentEngineOptions;
  startInput: AgentEngineStartInput;
}): Promise<CompareEngineImplementationsResult> {
  const runOne = async (): Promise<EngineComparePair> => {
    const started = Date.now();
    const { engine } = composeAgentEngine({
      ...params.createOptions("v8"),
      implementation: "v8",
    });
    const result = await engine.start(params.startInput).result;
    return {
      implementation: "v8",
      result,
      durationMs: Math.max(0, Date.now() - started),
    };
  };

  const pair = await runOne();
  return { legacy: pair, v8: pair };
}
