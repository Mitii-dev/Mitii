import type {
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentRunHandle,
  RestorePointSummary,
} from "../contracts";
import type { V8EngineImplementation } from "../constants";
import { composeRuntime, wrapEngineWithRuntimeShell } from "../../../runtime";
import type { RuntimePipeline } from "../../../runtime";
import { composeV8Engine } from "./composeV8Engine";
import type { ComposeV8EngineOptions } from "./composeV8Engine";
import {
  defaultV8EngineImplementation,
  isKnownV8EngineImplementation,
} from "../promotion";
import { sealEventBusStart } from "./SealEventBusStart";

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
   * `legacy` is accepted for compatibility and always resolves to `v8`.
   */
  implementation?: V8EngineImplementation | "legacy";
  /** Absolute workspace root for runtime tool adapter (optional dual-run). */
  workspaceRoot?: string;
  /**
   * @deprecated Ignored — runtime shell is always the product `engine`.
   * Event-bus start/resume are sealed (hard-deleted on the composed surface).
   */
  preferRuntimeShell?: boolean;
};

export type ComposedAgentEngine = {
  implementation: V8EngineImplementation;
  /** Primary host surface — runtime shell (live events). */
  engine: MitiiAgentEngine;
  /**
   * Restore owner. `start`/`resume` throw (`event_bus_*_deleted`).
   * Direct `new V8EnginePipeline` remains for internal goldens only.
   */
  eventBusEngine: MitiiAgentEngine;
  /** New runtime pump — always composed. */
  runtime: RuntimePipeline;
};

/**
 * Compose the v8 engine + dual-run runtime.
 * - `engine.start/resume` — runtime shell (live streaming)
 * - `eventBusEngine` — restore only (start/resume hard-deleted on this surface)
 * - `runtime.start/resume` — shell pump 1–11
 */
export function composeAgentEngine(
  options: ComposeAgentEngineOptions,
): ComposedAgentEngine {
  const implementation = parseV8EngineImplementation(options.implementation);
  const runtime = composeRuntime({
    runLlm: options.runLlm,
    toolRuntime: options.tools,
    workspaceRoot: options.workspaceRoot,
  });
  const rawEventBus = composeV8Engine(options);
  const engine = wrapEngineWithRuntimeShell(rawEventBus, runtime);
  const eventBusEngine = sealEventBusStart(rawEventBus);
  return {
    implementation,
    engine,
    eventBusEngine,
    runtime,
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

/**
 * @deprecated use composeAgentEngine().engine (runtime shell).
 * Previously returned raw event-bus; now returns the shell wrap.
 */
export function composeReadOnlyAgentEngine(
  options: ComposeAgentEngineOptions,
): MitiiAgentEngine {
  return composeAgentEngine(options).engine;
}

export type ComposeReadOnlyAgentEngineOptions = ComposeAgentEngineOptions;
