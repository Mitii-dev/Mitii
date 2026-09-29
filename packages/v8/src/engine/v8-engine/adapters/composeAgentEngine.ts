import type {
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentRunHandle,
  RestorePointSummary,
} from "../contracts";
import type { V8EngineImplementation } from "../constants";
import {
  composeReadOnlyAgentEngine,
  type ComposeReadOnlyAgentEngineOptions,
} from "../../agent-engine/adapters/composeReadOnlyAgentEngine";
import { composeV8Engine } from "./composeV8Engine";
import type { ComposeV8EngineOptions } from "./composeV8Engine";
import {
  defaultV8EngineImplementation,
  isKnownV8EngineImplementation,
} from "../promotion";

/** Shared host surface for legacy AgentEnginePipeline and V8EnginePipeline. */
export type MitiiAgentEngine = {
  start(input: AgentEngineStartInput): AgentRunHandle;
  resume(input: AgentEngineResumeInput): AgentRunHandle;
  restore(input: AgentEngineRestoreInput): Promise<AgentEngineRestoreResult>;
  listRestorePoints(runId: string): Promise<RestorePointSummary[]>;
};

export type ComposeAgentEngineOptions = ComposeReadOnlyAgentEngineOptions &
  ComposeV8EngineOptions & {
    /**
     * Which orchestrator to wire. When omitted, uses Phase 5 default (`v8`).
     * Hosts map `mitii.engine.implementation` here.
     */
    implementation?: V8EngineImplementation;
  };

export type ComposedAgentEngine = {
  implementation: V8EngineImplementation;
  engine: MitiiAgentEngine;
};

/**
 * Compose legacy or v8 engine with the same dependency bag.
 * Default is `v8` (Phase 5); pass `implementation: "legacy"` for Agent Engine.
 */
export function composeAgentEngine(
  options: ComposeAgentEngineOptions,
): ComposedAgentEngine {
  const implementation = parseV8EngineImplementation(options.implementation);
  if (implementation === "v8") {
    return {
      implementation,
      engine: composeV8Engine(options),
    };
  }
  return {
    implementation,
    engine: composeReadOnlyAgentEngine(options),
  };
}

/** Normalize host/setting strings to a known implementation id. */
export function parseV8EngineImplementation(
  value: unknown,
): V8EngineImplementation {
  if (isKnownV8EngineImplementation(value)) {
    return value;
  }
  return defaultV8EngineImplementation();
}

export function isMitiiAgentEngine(
  value: unknown,
): value is MitiiAgentEngine {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as MitiiAgentEngine).start === "function" &&
    typeof (value as MitiiAgentEngine).resume === "function" &&
    typeof (value as MitiiAgentEngine).restore === "function"
  );
}
