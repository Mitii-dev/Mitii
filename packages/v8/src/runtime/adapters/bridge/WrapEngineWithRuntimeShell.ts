import type {
  AgentEngineResumeInput,
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineStartInput,
  AgentRunHandle,
  RestorePointSummary,
} from "../../../engine/v8-engine/contracts";
import { adaptHostStartToRuntime } from "../../helpers/adapt/AdaptHostStartToRuntime";
import type { RuntimePipeline } from "../../flow/Pipeline";
import { adaptEngineResumeToRuntime } from "./AdaptEngineResumeToRuntime";
import {
  createLiveAgentRunHandleFromRuntimeResume,
  createLiveAgentRunHandleFromRuntimeStart,
} from "./CreateLiveAgentRunHandle";

/** Engine surface the P8 shell wrapper replaces for start/resume. */
export interface RuntimeShellEngineSurface {
  start(input: AgentEngineStartInput): AgentRunHandle;
  resume(input: AgentEngineResumeInput): AgentRunHandle;
  restore(
    input: AgentEngineRestoreInput,
  ): Promise<AgentEngineRestoreResult>;
  listRestorePoints(runId: string): Promise<RestorePointSummary[]>;
}

/**
 * P8 shim: `engine.start/resume` → RuntimePipeline with live event streaming;
 * restore stays on core.
 */
export function wrapEngineWithRuntimeShell<T extends RuntimeShellEngineSurface>(
  engine: T,
  runtime: RuntimePipeline,
): T {
  const sessions = new Map<
    string,
    { message: string; mode: "ask" | "plan" | "agent" }
  >();

  const start = (input: AgentEngineStartInput): AgentRunHandle => {
    const adapted = adaptHostStartToRuntime({
      ...input,
      dirtyPaths: input.dirtyPaths,
      requiredSkillIds: input.requiredSkillIds,
      requiredMcpServerIds: input.requiredMcpServerIds,
      workspaceRoot: input.workspaceRoot,
      windowBudget: input.windowBudget,
      approvalMode: input.approvalMode,
      explorationDepth: input.explorationDepth,
      runtimeSituation: input.runtimeSituation,
      instructions: input.instructions,
      userSafetyRules: input.userSafetyRules,
      host: {
        dirtyPaths: [
          ...(input.dirtyPaths ?? []),
          ...(input.runtimeSituation?.host?.dirtyPaths ?? []),
        ],
        cwd: input.runtimeSituation?.host?.cwd ?? input.workspaceRoot,
        focusedFile: input.runtimeSituation?.host?.focusedFile,
        diagnostics: input.runtimeSituation?.host?.diagnostics ?? [],
        selection: input.runtimeSituation?.host?.selection,
      },
      git: input.runtimeSituation?.git,
      catalog: input.runtimeSituation?.catalog,
      impact: input.runtimeSituation?.impact,
      memory: input.runtimeSituation?.memory,
    });
    const runId =
      adapted.runId ??
      `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const message = adapted.message;
    const mode = adapted.mode;
    sessions.set(runId, { message, mode });

    const { mode: _mode, ...startFields } = adapted;
    return createLiveAgentRunHandleFromRuntimeStart({
      runtime,
      start: {
        ...startFields,
        message,
        runId,
      },
      mode,
      runId,
    });
  };

  const resume = (input: AgentEngineResumeInput): AgentRunHandle => {
    const runId = input.runId;
    const pending = (async () => {
      const session = sessions.get(runId);
      const stored = await runtime.loadSession(runId);
      const adapted = adaptEngineResumeToRuntime({
        input,
        fallbackMessage: session?.message ?? stored?.message ?? "continue",
        mode: session?.mode ?? stored?.mode ?? "agent",
      });

      if (adapted.clarifyAnswer) {
        sessions.set(runId, {
          message: adapted.clarifyAnswer,
          mode: session?.mode ?? stored?.mode ?? "agent",
        });
      }

      return createLiveAgentRunHandleFromRuntimeResume({
        runtime,
        resume: {
          runId: adapted.runId,
          decision: adapted.decision,
          target: adapted.target,
          clarifyAnswer: adapted.clarifyAnswer,
          guidance: adapted.guidance,
          message: adapted.message,
          mode: adapted.mode,
        },
      });
    })();

    return {
      runId,
      events: (async function* () {
        const handle = await pending;
        for await (const event of handle.events) {
          yield event;
        }
      })(),
      result: pending.then((handle) => handle.result),
      cancel(reason?: string) {
        void pending.then((handle) => handle.cancel(reason));
      },
    };
  };

  return {
    ...engine,
    start,
    resume,
  };
}
