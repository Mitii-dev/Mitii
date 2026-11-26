import { RUNTIME_REASON_CODES } from "../constants";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import type { RuntimeResumeInput } from "../contracts/input/RuntimeResumeInput";
import type { RuntimeRunResult } from "../contracts/output/RuntimeRunResult";
import type { RuntimeDependencies } from "../ports/RuntimeDependencies";
import { RUNTIME_FLOW_STEP_IDS } from "./order";
import {
  runEarlyPipeline,
  type RunEarlyPipelineResult,
} from "./RunEarlyPipeline";
import {
  runThroughPlanPipeline,
  type RunThroughPlanPipelineResult,
} from "./RunThroughPlanPipeline";
import {
  runThroughTurnLoop,
  type RunThroughTurnLoopResult,
} from "./RunThroughTurnLoop";
import { executeRuntimeStart } from "./ExecuteRuntimeStart";
import { executeRuntimeResume } from "./ExecuteRuntimeResume";
import { adaptHostStartToRuntime } from "../helpers/adapt/AdaptHostStartToRuntime";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";

/**
 * Thin pump shell. Steps 1–11 + start/resume + optional model/tool ports.
 */
export class RuntimePipeline {
  readonly stepIds = RUNTIME_FLOW_STEP_IDS;

  constructor(private readonly deps: RuntimeDependencies = {}) {}

  /** P2: window → orient → assess → peeks → decide → gates. */
  async runEarly(input: {
    start: RuntimeStartInput;
    mode?: "ask" | "plan" | "agent";
    runId?: string;
  }): Promise<RunEarlyPipelineResult> {
    return runEarlyPipeline({ ...input, deps: this.deps });
  }

  /** P3: early + plan pipeline + gates-after-plan. */
  async runThroughPlan(input: {
    start: RuntimeStartInput;
    mode?: "ask" | "plan" | "agent";
    runId?: string;
  }): Promise<RunThroughPlanPipelineResult> {
    return runThroughPlanPipeline({ ...input, deps: this.deps });
  }

  /** P4: through plan then enrich + turn-loop (ports when composed). */
  async runThroughTurn(input: {
    start: RuntimeStartInput;
    mode?: "ask" | "plan" | "agent";
    runId?: string;
  }): Promise<RunThroughTurnLoopResult> {
    return runThroughTurnLoop({ ...input, deps: this.deps });
  }

  /**
   * Runtime start entry (shell pump 1–11).
   * Accepts RuntimeStartInput or a loose agent-start-shaped object.
   */
  async start(
    input:
      | ExecuteRuntimeStartLoose
      | {
          start: RuntimeStartInput;
          mode?: "ask" | "plan" | "agent";
          runId?: string;
          eventSink?: RuntimeEventSink;
          abortSignal?: AbortSignal;
        },
  ): Promise<RuntimeRunResult> {
    if ("start" in input && input.start && typeof input.start === "object") {
      return executeRuntimeStart({
        start: input.start,
        mode: input.mode,
        runId: input.runId,
        deps: this.deps,
        eventSink: input.eventSink,
        abortSignal: input.abortSignal,
      });
    }
    const adapted = adaptHostStartToRuntime(input as ExecuteRuntimeStartLoose);
    if (!adapted.message || adapted.message === "(empty)") {
      throw new Error("runtime_invalid_start_message");
    }
    const { mode, ...startFields } = adapted;
    return executeRuntimeStart({
      start: startFields,
      mode,
      runId: adapted.runId,
      deps: this.deps,
      eventSink: (input as { eventSink?: RuntimeEventSink }).eventSink,
      abortSignal: (input as { abortSignal?: AbortSignal }).abortSignal,
    });
  }

  /** Runtime resume entry — reenter plan + re-drive shell. */
  async resume(
    input: RuntimeResumeInput & {
      /** Optional when sessionStore has carry for this runId. */
      message?: string;
      mode?: "ask" | "plan" | "agent";
      eventSink?: RuntimeEventSink;
      abortSignal?: AbortSignal;
    },
  ): Promise<RuntimeRunResult> {
    return executeRuntimeResume({ ...input, deps: this.deps });
  }

  /** Load durable session carry (message/mode) when a sessionStore is composed. */
  async loadSession(runId: string) {
    return this.deps.sessionStore?.load(runId);
  }

  /** Load thin gate checkpoint when a checkpointStore is composed. */
  async loadCheckpoint(runId: string) {
    return this.deps.checkpointStore?.load?.(runId);
  }

  /** @deprecated use start() — kept so older call sites fail loudly. */
  async run(): Promise<never> {
    throw new Error(RUNTIME_REASON_CODES.not_implemented);
  }
}

type ExecuteRuntimeStartLoose = {
  request?: {
    userMessage?: string;
    mode?: string;
    conversation?: Array<{ role?: string; content?: string }>;
  };
  message?: string;
  mode?: string;
  contextWindowTokens?: number;
  runId?: string;
};
