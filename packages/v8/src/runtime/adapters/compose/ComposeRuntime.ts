import { RuntimePipeline } from "../../flow/Pipeline";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type {
  LlmPort,
  ModelToolDefinition,
} from "../../../modules/model-gateway";
import type { ToolRuntimePipeline } from "../../../engine/tool-runtime";
import { InMemoryRuntimeSessionStore } from "../../helpers/checkpoint/InMemoryRuntimeSessionStore";
import type { RuntimeSessionStorePort } from "../../helpers/checkpoint/RuntimeSessionCarry";
import { InMemoryGateCheckpointStore } from "../../helpers/gates/InMemoryGateCheckpointStore";
import type { GateCheckpointStorePort } from "../../helpers/gates/types";
import { completeViaLlmPort } from "../model/CompleteViaLlmPort";
import type { RuntimeToolExecutorPort } from "../../ports/RuntimeToolExecutorPort";
import { createInlineVerificationRunner } from "../../ports/RuntimeVerificationRunnerPort";
import { createPipelineVerificationRunner } from "../verification/CreatePipelineVerificationRunner";
import { createPromptConstructionPort } from "../prompt/CreatePromptConstructionPort";
import { executeViaToolRuntime } from "../tools/ExecuteViaToolRuntime";

export type ComposeRuntimeOptions = {
  /** Optional model — LlmPort is adapted, or pass RuntimeModelPort via `model`. */
  runLlm?: LlmPort;
  model?: RuntimeDependencies["model"];
  /** Schemas for grant-surface tool names (passed into completeViaLlmPort). */
  toolDefinitions?: readonly ModelToolDefinition[];
  /** Pre-built tool executor, or pass `toolRuntime` + `workspaceRoot` to adapt. */
  tools?: RuntimeToolExecutorPort;
  toolRuntime?: ToolRuntimePipeline;
  workspaceRoot?: string;
  wallTimeSoftMs?: number;
  heartbeatIntervalMs?: number;
  /** S11-HEART durable checkpoint kill-switch / every-N-turns. */
  heartbeat?: boolean;
  heartbeatEveryTurns?: number;
  /** Defaults to in-memory carry store when omitted. */
  sessionStore?: RuntimeSessionStorePort;
  /** When true, skip default in-memory session store. */
  disableSessionStore?: boolean;
  /** Defaults to in-memory gate checkpoint store when omitted. */
  checkpointStore?: GateCheckpointStorePort;
  /** When true, skip default in-memory gate checkpoint store. */
  disableCheckpointStore?: boolean;
  /** Optional verify runner port (inline/default when omitted). */
  verification?: RuntimeDependencies["verification"];
  /** When true, skip default inline verification runner. */
  disableVerification?: boolean;
  /** MCP server ids stamped onto the run at start. */
  mcpServerIds?: string[];
  /** Enrich retrieval ports (skills / memory / repo). */
  enrich?: RuntimeDependencies["enrich"];
  /** Prompt-construction port (S11-BRIEF). Defaults to PromptConstructionPipeline. */
  promptConstruction?: RuntimeDependencies["promptConstruction"];
  /** When true, skip default prompt-construction port. */
  disablePromptConstruction?: boolean;
  /** Finish-time memory commit port (S11-MEM). */
  memoryCommit?: RuntimeDependencies["memoryCommit"];
  /**
   * Full modules/verification pipeline — replaces inline runner when set
   * (with `verificationInput` factory).
   */
  verificationPipeline?: import("../../../modules/verification").VerificationPipeline;
  /** Builds VerificationInput for the pipeline runner; omit → skip. */
  verificationInput?: import("../verification/CreatePipelineVerificationRunner").VerificationInputFactory;
};

/**
 * Wire facades into RuntimePipeline.
 * When `runLlm` / tools are set, turn loop uses ports (P8 adapter evacuate).
 */
export function composeRuntime(
  options: ComposeRuntimeOptions = {},
): RuntimePipeline {
  const tools =
    options.tools ??
    (options.toolRuntime && options.workspaceRoot
      ? executeViaToolRuntime({
          pipeline: options.toolRuntime,
          workspaceRoot: options.workspaceRoot,
        })
      : undefined);

  const sessionStore =
    options.sessionStore ??
    (options.disableSessionStore
      ? undefined
      : new InMemoryRuntimeSessionStore());

  const checkpointStore =
    options.checkpointStore ??
    (options.disableCheckpointStore
      ? undefined
      : new InMemoryGateCheckpointStore());

  const verification =
    options.verification ??
    (options.verificationPipeline && options.verificationInput
      ? createPipelineVerificationRunner({
          pipeline: options.verificationPipeline,
          buildInput: options.verificationInput,
        })
      : options.disableVerification
        ? undefined
        : createInlineVerificationRunner());

  const promptConstruction =
    options.promptConstruction ??
    (options.disablePromptConstruction
      ? undefined
      : createPromptConstructionPort());

  const deps: RuntimeDependencies = {
    model:
      options.model ??
      (options.runLlm
        ? completeViaLlmPort(options.runLlm, {
            toolDefinitions: options.toolDefinitions,
          })
        : undefined),
    tools,
    wallTimeSoftMs: options.wallTimeSoftMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    heartbeat: options.heartbeat,
    heartbeatEveryTurns: options.heartbeatEveryTurns,
    sessionStore,
    checkpointStore,
    verification,
    mcpServerIds: options.mcpServerIds,
    enrich: options.enrich,
    promptConstruction,
    memoryCommit: options.memoryCommit,
  };
  return new RuntimePipeline(deps);
}
