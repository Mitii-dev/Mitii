import {
  agentEngineResumeInputSchema,
  agentEngineStartInputSchema,
  AgentEngineError,
} from "../contracts";
import type {
  AgentEngineDependencies,
  AgentEngineResumeInput,
  AgentEngineStartInput,
  AgentRunHandle,
} from "../contracts";
import { executeResume } from "./executeResume";
import { executeStart } from "./executeStart";
import {
  createAgentEngineRuntime,
  createRunHandle,
  resolveAgentEngineDeps,
  type AgentEngineRuntime,
} from "./runtime";

export type AgentEnginePipelineDependencies = AgentEngineDependencies;

/**
 * Agent Engine facade (Phase 8 mutation + Phase 9 optional Skills/Memory).
 *
 * Flow:
 *   Intake → Understand → Decide → pin Repository State
 *   → select Skills (optional) → retrieve Memory (optional)
 *   → retrieve Context → construct Prompt → invoke Model
 *   → execute authorized Tools (read-only or mutating) as needed
 *   → verify changes → produce Result
 *
 * Mutation tool calls that require approval suspend the run with a
 * persisted checkpoint; `resume()` continues without replaying completed
 * tool callIds. Does not implement understanding, policy, retrieval,
 * prompting, tool enforcement, skills/memory selection, or verification.
 */
export class AgentEnginePipeline {
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
        "Agent Engine start input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const runId = this.runtime.deps.idGenerator.next("run");
    const carriedPlan = parsed.approvedPlan;
    return createRunHandle(runId, (bus, signal, getCancelReason) =>
      executeStart(this.runtime, {
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

  /**
   * Resume a suspended run after clarification or approval.
   * Continues from the persisted checkpoint; does not replay completed
   * tool callIds.
   */
  public resume(input: AgentEngineResumeInput): AgentRunHandle {
    let parsed: AgentEngineResumeInput;
    try {
      parsed = agentEngineResumeInputSchema.parse(input);
    } catch (error) {
      throw new AgentEngineError(
        "invalid_input",
        "Agent Engine resume input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return createRunHandle(parsed.runId, (bus, signal, getCancelReason) =>
      executeResume(this.runtime, {
        input: parsed,
        bus,
        signal,
        getCancelReason,
      }),
    );
  }
}
