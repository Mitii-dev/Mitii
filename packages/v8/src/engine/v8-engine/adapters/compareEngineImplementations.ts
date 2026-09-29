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
 * Run the same start input on both orchestrators for side-by-side golden compares.
 *
 * Pass a factory so each side gets a fresh LLM / tool script (ports are stateful).
 * Checkpoints are not shared across implementations — do not resume across a flip.
 */
export async function compareEngineImplementations(params: {
  createOptions: (
    implementation: V8EngineImplementation,
  ) => ComposeAgentEngineOptions;
  startInput: AgentEngineStartInput;
}): Promise<CompareEngineImplementationsResult> {
  const runOne = async (
    implementation: V8EngineImplementation,
  ): Promise<EngineComparePair> => {
    const started = Date.now();
    const { engine } = composeAgentEngine({
      ...params.createOptions(implementation),
      implementation,
    });
    const result = await engine.start(params.startInput).result;
    return {
      implementation,
      result,
      durationMs: Math.max(0, Date.now() - started),
    };
  };

  const [legacy, v8] = await Promise.all([runOne("legacy"), runOne("v8")]);
  return { legacy, v8 };
}
