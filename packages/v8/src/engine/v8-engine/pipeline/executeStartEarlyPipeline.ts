/**
 * Intake → Pin → Agent-execute preflight → Understand → Decide.
 * Phase bodies live in sibling files; this file only orders them.
 */
import { handleMetaCommand } from "../modules/session-control";
import type { AgentEngineRuntime } from "./runtime";
import {
  buildSessionControlResult,
  captureAgentExecutePreflight,
} from "./earlyPipelineSupport";
import { resolveAndPinState } from "./pinAndDiscovery";
import { applyStartReuse } from "./startReuse";
import { shouldCaptureUnconditionalAgentPreflight } from "../actions";
import { runStartEarlyUnderstand } from "./executeStartEarlyUnderstand";
import { runStartEarlyDecide } from "./executeStartEarlyDecide";
import type {
  StartEarlyPipelineOutcome,
  StartEarlyPipelineParams,
} from "./executeStartEarlyPipelineTypes";

export type {
  ExecuteStartSharedState,
  StartEarlyPipelineContinue,
  StartEarlyPipelineOutcome,
  StartEarlyFinish,
  StartEarlyPipelineParams,
} from "./executeStartEarlyPipelineTypes";

export async function runStartEarlyPipeline(
  runtime: AgentEngineRuntime,
  params: StartEarlyPipelineParams,
): Promise<StartEarlyPipelineOutcome> {
  const {
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    reasonCodes,
    warnings,
    shared,
    finish,
    cancelledResult,
  } = params;

  // --- Intake ---
  runtime.emitStage(bus, runId, "received", "started");
  const intakeDetailed = runtime.deps.intake.intakeDetailed?.bind(
    runtime.deps.intake,
  );
  const intakeResult = intakeDetailed
    ? intakeDetailed(input.request)
    : {
        envelope: runtime.deps.intake.intake(input.request),
        warnings: [] as string[],
        shortCircuitMeta: false,
      };
  const envelope = intakeResult.envelope;
  shared.requestId = envelope.requestId;
  reasonCodes.push("intake_complete");
  if (intakeResult.warnings.length > 0) {
    warnings.push(...intakeResult.warnings);
  }
  if (
    (envelope.referencedArtifacts?.length ?? 0) > 0 &&
    /\B@[^\s]/.test(envelope.message)
  ) {
    reasonCodes.push("intake_mentions_extracted");
  }
  runtime.emitStage(bus, runId, "received", "completed", ["intake_complete"]);

  // Meta slash commands (stop/new/clear/compact/…) never enter understand/pin.
  const shortCircuitMeta =
    intakeResult.shortCircuitMeta ||
    (envelope.metaCommand !== undefined &&
      envelope.metaCommand.lifecycle !== "agent_turn" &&
      !(
        envelope.metaCommand.lifecycle === "agent_turn_with_args" &&
        envelope.metaCommand.args.trim().length > 0
      ));
  if (shortCircuitMeta && envelope.metaCommand) {
    reasonCodes.push("intake_meta_command");
    const handled = handleMetaCommand({
      meta: envelope.metaCommand,
      conversation: input.conversation,
      estimator: runtime.tokenEstimator,
      windowPolicy,
      sessionId: envelope.sessionId,
    });
    reasonCodes.push(
      ...(handled.reasonCodes as typeof reasonCodes).filter(
        (code) => !reasonCodes.includes(code),
      ),
    );
    if (handled.warnings.length > 0) {
      warnings.push(...handled.warnings);
    }
    warnings.push(`meta_command:${handled.command}:${handled.lifecycle}`);

    const sessionControl = buildSessionControlResult(handled);

    return {
      kind: "terminal",
      result: finish({
        status: handled.status,
        answer: handled.answer,
        sessionControl,
        reasonCodes,
        ...(handled.error ? { error: handled.error } : {}),
      }),
    };
  }

  if (signal.aborted) {
    return { kind: "terminal", result: await cancelledResult() };
  }

  if (params.reuse) {
    return {
      kind: "continue",
      state: applyStartReuse({
        reuse: params.reuse,
        shared,
        reasonCodes,
        input,
        envelope,
      }),
    };
  }

  // --- Pin ---
  // Ahead of Decide/Understand now: pin whenever a workspace is
  // resolvable so an Agent-execute preflight snapshot (below) can run
  // before understanding, and so errors can inform classification.
  shared.pinnedState = await resolveAndPinState(runtime, {
    runId,
    envelope,
    input,
    bus,
    reasonCodes,
    warnings,
  });

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Agent-execute preflight snapshot (before Understand) ---
  // Repair/mutation asks only. Status questions and "run the tests"
  // must not launch discovered e2e/WDIO scripts before the model runs.
  // Plan mode keeps its repair-intent-gated capture further down, once
  // understanding/decision exist.
  if (
    envelope.mode === "agent" &&
    shouldCaptureUnconditionalAgentPreflight(envelope.message)
  ) {
    await captureAgentExecutePreflight(runtime, {
      runId,
      input,
      envelope,
      bus,
      signal,
      reasonCodes,
      warnings,
      shared,
    });
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Understand ---
  const understood = await runStartEarlyUnderstand({
    runtime,
    runId,
    input,
    bus,
    envelope,
    shared,
    reasonCodes,
  });

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Decide ---
  return runStartEarlyDecide({
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy: params.windowPolicy,
    budget: params.budget,
    reasonCodes,
    warnings,
    startedMs: params.startedMs,
    shared,
    taskListRef: params.taskListRef,
    finish,
    cancelledResult,
    envelope,
    understanding: understood.understanding,
    executionSeed: understood.executionSeed,
    candidateRelativePaths: understood.candidateRelativePaths,
  });
}
