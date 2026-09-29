import {
  AgentEngineError,
  agentEngineResumeInputSchema,
  agentEngineStartInputSchema,
} from "../contracts";
import type {
  AgentEngineDependencies,
  AgentEngineResumeInput,
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineStartInput,
  AgentRunHandle,
} from "../contracts";
import {
  createAgentEngineRuntime,
  createRunHandle,
  resolveAgentEngineDeps,
} from "./runtime";
import type { AgentEngineRuntime } from "./runtime";
import { executeRestore } from "./executeRestore";
import { executeV8Start } from "./executeStart";
import { executeV8Resume } from "./executeResume";

export type V8EnginePipelineDependencies = AgentEngineDependencies;

/**
 * V8 Engine facade. Same host surface as AgentEnginePipeline.
 * Phase 3: start + resume (Continue/clarify/plan/approval) + restore.
 */
export class V8EnginePipeline {
  private readonly runtime: AgentEngineRuntime;

  constructor(dependencies: AgentEngineDependencies) {
    this.runtime = createAgentEngineRuntime(
      resolveAgentEngineDeps(dependencies),
    );
  }

  public start(input: AgentEngineStartInput): AgentRunHandle {
    let parsed: AgentEngineStartInput;
    try {
      parsed = agentEngineStartInputSchema.parse(input);
    } catch (error) {
      throw new AgentEngineError(
        "invalid_input",
        "V8 Engine start input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const runId = this.runtime.deps.idGenerator.next("run");
    const carriedPlan = parsed.approvedPlan;
    return createRunHandle(runId, (bus, signal, getCancelReason) =>
      executeV8Start(this.runtime, {
        runId,
        input: parsed,
        bus,
        signal,
        getCancelReason,
        approvedPlan: carriedPlan,
        approvedPlanStrategy: parsed.approvedPlanStrategy,
        skipPlanGate: Boolean(carriedPlan),
        planSource: carriedPlan ? "host_carry" : undefined,
      }),
    );
  }

  public resume(input: AgentEngineResumeInput): AgentRunHandle {
    let parsed: AgentEngineResumeInput;
    try {
      parsed = agentEngineResumeInputSchema.parse(input);
    } catch (error) {
      throw new AgentEngineError(
        "invalid_input",
        "V8 Engine resume input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return createRunHandle(parsed.runId, (bus, signal, getCancelReason) =>
      executeV8Resume(this.runtime, {
        input: parsed,
        bus,
        signal,
        getCancelReason,
      }),
    );
  }

  public restore(
    input: AgentEngineRestoreInput,
  ): Promise<AgentEngineRestoreResult> {
    return executeRestore(this.runtime, input);
  }

  public async listRestorePoints(runId: string) {
    const store = this.runtime.deps.checkpointStore;
    if (!store?.listRestorePoints) {
      return [];
    }
    return store.listRestorePoints(runId);
  }

  public getDependencies(): AgentEngineDependencies {
    return this.runtime.deps;
  }
}
