import type { RuntimeSessionStorePort } from "../helpers/checkpoint/RuntimeSessionCarry";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
import type { GateCheckpointStorePort } from "../helpers/gates/types";
import type { RuntimeEnrichRetrievalPorts } from "./RuntimeEnrichRetrievalPorts";
import type { RuntimeModelPort } from "./RuntimeModelPort";
import type { RuntimePromptConstructionPort } from "./RuntimePromptConstructionPort";
import type { RuntimeToolExecutorPort } from "./RuntimeToolExecutorPort";
import type { RuntimeVerificationRunnerPort } from "./RuntimeVerificationRunnerPort";

/** Optional injected adapters for composeRuntime / turn loop. */
export interface RuntimeDependencies {
  model?: RuntimeModelPort;
  tools?: RuntimeToolExecutorPort;
  /** Soft wall for turn loop nudges (ms). */
  wallTimeSoftMs?: number;
  /** Heartbeat interval for long runs (ms) — soft emit / usage sketch. */
  heartbeatIntervalMs?: number;
  /** Host kill-switch for durable heartbeat checkpoints (S11-HEART). */
  heartbeat?: boolean;
  /** Turns between heartbeat checkpoints (default 3). */
  heartbeatEveryTurns?: number;
  /** Durable message/mode carry for resume without host re-prompt. */
  sessionStore?: RuntimeSessionStorePort;
  /** Thin gate checkpoint save/load on suspend (hydrate on resume). */
  checkpointStore?: GateCheckpointStorePort;
  /** Optional verify runner — inline/default until module wires hosts. */
  verification?: RuntimeVerificationRunnerPort;
  /** MCP server ids to stamp onto the run grant surface at start. */
  mcpServerIds?: string[];
  /**
   * Enrich retrieval ports (skills / memory / repo) — modules own pipelines.
   */
  enrich?: RuntimeEnrichRetrievalPorts;
  /**
   * Prompt-construction port (S11-BRIEF) — modules own packing; turn loop
   * uses buildBriefcaseViaPC when set.
   */
  promptConstruction?: RuntimePromptConstructionPort;
  /**
   * Live event sink for progressive MitiiRun streaming while the pump runs.
   * Prefer per-start override via ExecuteRuntimeStartInput.eventSink.
   */
  eventSink?: RuntimeEventSink;
}