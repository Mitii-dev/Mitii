import type {
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentRunHandle,
  RestorePointSummary,
} from "../contracts";
import type { V8EngineImplementation } from "../constants";
import { composeV8Engine } from "./composeV8Engine";
import type { ComposeV8EngineOptions } from "./composeV8Engine";
import {
  defaultV8EngineImplementation,
  isKnownV8EngineImplementation,
} from "../promotion";

/** Shared host surface for V8EnginePipeline. */
export type MitiiAgentEngine = {
  start(input: AgentEngineStartInput): AgentRunHandle;
  resume(input: AgentEngineResumeInput): AgentRunHandle;
  restore(input: AgentEngineRestoreInput): Promise<AgentEngineRestoreResult>;
  listRestorePoints(runId: string): Promise<RestorePointSummary[]>;
};

export type ComposeAgentEngineOptions = ComposeV8EngineOptions & {
  /**
   * Which orchestrator to wire. When omitted, uses default (`v8`).
   * `legacy` is removed in Phase 10 — unknown values fall back to `v8` with a warning.
   */
  implementation?: V8EngineImplementation | "legacy";
};

export type ComposedAgentEngine = {
  implementation: V8EngineImplementation;
  engine: MitiiAgentEngine;
};

/**
 * Compose the v8 engine. Legacy `implementation: "legacy"` is accepted for
 * host settings compatibility but always resolves to v8 (Phase 10).
 */
export function composeAgentEngine(
  options: ComposeAgentEngineOptions,
): ComposedAgentEngine {
  const implementation = parseV8EngineImplementation(options.implementation);
  return {
    implementation,
    engine: composeV8Engine(options),
  };
}

/** Normalize host/setting strings to a known implementation id. */
export function parseV8EngineImplementation(
  value: unknown,
): V8EngineImplementation {
  if (value === "legacy") {
    return "v8";
  }
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

/** @deprecated Phase 10 — use composeAgentEngine; returns v8 engine only. */
export function composeReadOnlyAgentEngine(
  options: ComposeAgentEngineOptions,
): MitiiAgentEngine {
  return composeAgentEngine(options).engine;
}

export type ComposeReadOnlyAgentEngineOptions = ComposeAgentEngineOptions;
