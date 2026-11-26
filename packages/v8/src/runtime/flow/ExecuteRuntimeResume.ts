import {
  runtimeResumeInputSchema,
  type RuntimeResumeInput,
} from "../contracts/input/RuntimeResumeInput";
import {
  runtimeRunResultSchema,
  type RuntimeRunResult,
} from "../contracts/output/RuntimeRunResult";
import {
  resumeCheckpointConflict,
  resumeClarification,
  resumeContinueDecision,
  resumeAuthOrDependency,
  resumeExternalSideEffect,
  resumeGrantExpansion,
  resumeMutationApproval,
  resumePlanDecision,
  type ResumePlan,
} from "../helpers/gates";
import { checkPlanFreshness } from "../helpers/build/CheckPlanFreshness";
import { readStoreSnapshotFromCheckpoint } from "../helpers/checkpoint/ReadStoreSnapshotFromCheckpoint";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
import { steerPlanArtifact } from "../helpers/plan";
import type { PlanArtifact } from "../../modules/planning";
import { applyReplateToSnapshot } from "../helpers/replate";
import type { RuntimeDependencies } from "../ports/RuntimeDependencies";
import { executeRuntimeStart } from "./ExecuteRuntimeStart";

/**
 * Runtime resume — maps host decision → reenter plan, then re-runs start shell.
 * Loads session carry from deps.sessionStore when message/mode omitted.
 * Checks Build plan freshness when approving a plan.
 */

export async function executeRuntimeResume(
  input: RuntimeResumeInput & {
    /** Prior message; optional when sessionStore has carry for runId. */
    message?: string;
    mode?: "ask" | "plan" | "agent";
    deps?: RuntimeDependencies;
    eventSink?: RuntimeEventSink;
    abortSignal?: AbortSignal;
  },
): Promise<RuntimeRunResult> {
  const parsed = runtimeResumeInputSchema.parse({
    runId: input.runId,
    decision: input.decision,
    target: input.target,
    conflictAction: input.conflictAction,
    authAction: input.authAction,
    clarifyAnswer: input.clarifyAnswer,
    guidance: input.guidance,
    approvedPlanFingerprint: input.approvedPlanFingerprint,
    planSteer: input.planSteer,
  });
  const decision = parsed.decision ?? "continue";
  const plan = mapResumeDecision(
    decision,
    parsed.target,
    parsed.conflictAction,
    parsed.authAction,
  );

  if (plan.terminal) {
    return runtimeRunResultSchema.parse({
      schemaVersion: 1,
      runId: parsed.runId,
      status: "cancelled",
      resumeReenter: plan.reenter,
      reasonCodes: [
        ...(plan.reasonCodes ?? []),
        "runtime_resume_terminal",
      ],
    });
  }

  const carry = await input.deps?.sessionStore?.load(parsed.runId);
  const priorCheckpoint = await input.deps?.checkpointStore?.load?.(
    parsed.runId,
  );
  const message =
    parsed.clarifyAnswer?.trim() ||
    parsed.guidance?.trim() ||
    input.message?.trim() ||
    carry?.message?.trim() ||
    "";

  if (!message) {
    throw new Error("runtime_resume_missing_message");
  }

  const mode = input.mode ?? carry?.mode ?? "agent";
  let hydrateSnapshot = readStoreSnapshotFromCheckpoint(priorCheckpoint);
  const replateCodes: string[] = [];
  const steerCodes: string[] = [];

  // S3A-STEER: patch plan artifact in hydrated snapshot without rediscovery.
  if (decision === "steer" && parsed.planSteer && hydrateSnapshot) {
    const priorPlan = hydrateSnapshot.slices.planArtifact as
      | PlanArtifact
      | undefined;
    if (priorPlan && typeof priorPlan === "object" && "phases" in priorPlan) {
      const steered = steerPlanArtifact({
        plan: priorPlan,
        patch: parsed.planSteer,
      });
      hydrateSnapshot = {
        ...hydrateSnapshot,
        slices: {
          ...hydrateSnapshot.slices,
          planArtifact: steered.plan,
          planSteer: {
            needsRediscovery: steered.needsRediscovery,
            reasonCodes: steered.reasonCodes,
          },
        },
      };
      steerCodes.push(...steered.reasonCodes);
    }
  }

  // S10-REPLATE: approve-plan mints a new execute decision (scopes ⊆ plan).
  if (plan.replate) {
    const applied = applyReplateToSnapshot({
      snapshot: hydrateSnapshot,
      mcpServerIds: input.deps?.mcpServerIds,
    });
    hydrateSnapshot = applied.snapshot;
    replateCodes.push(...applied.reasonCodes);
  }

  const storePlanFingerprint =
    (typeof hydrateSnapshot?.slices.planFingerprint === "string"
      ? hydrateSnapshot.slices.planFingerprint
      : undefined) ??
    (typeof priorCheckpoint?.payload?.planFingerprint === "string"
      ? priorCheckpoint.payload.planFingerprint
      : undefined);

  const freshness =
    decision === "approve" && (parsed.target === "plan" || parsed.target == null)
      ? checkPlanFreshness({
          approvedPlanFingerprint: parsed.approvedPlanFingerprint,
          storePlanFingerprint,
        })
      : { reasonCodes: [] as string[] };

  const result = await executeRuntimeStart({
    start: {
      runId: parsed.runId,
      message,
    },
    mode,
    runId: parsed.runId,
    deps: input.deps,
    hydrateSnapshot,
    eventSink: input.eventSink,
    abortSignal: input.abortSignal,
  });

  return runtimeRunResultSchema.parse({
    ...result,
    runId: parsed.runId,
    resumeReenter: plan.reenter,
    gateKind: result.gateKind ?? priorCheckpoint?.suspensionKind,
    planFresh: "fresh" in freshness ? freshness.fresh : result.planFresh,
    planFingerprint:
      ("storePlanFingerprint" in freshness
        ? freshness.storePlanFingerprint
        : undefined) ?? result.planFingerprint,
    reasonCodes: [
      ...result.reasonCodes,
      ...(plan.reasonCodes ?? []),
      ...freshness.reasonCodes,
      ...replateCodes,
      ...steerCodes,
      ...(carry ? ["runtime_resume_from_session_carry"] : []),
      ...(priorCheckpoint ? ["runtime_resume_from_gate_checkpoint"] : []),
      "runtime_resume_completed",
    ],
  });
}

function mapResumeDecision(
  decision: NonNullable<RuntimeResumeInput["decision"]> | "continue",
  target?: RuntimeResumeInput["target"],
  conflictAction?: RuntimeResumeInput["conflictAction"],
  authAction?: RuntimeResumeInput["authAction"],
): ResumePlan {
  if (target === "conflict") {
    if (decision === "reject" || conflictAction === "cancel") {
      return resumeCheckpointConflict({ action: "cancel" });
    }
    if (conflictAction === "resync" || decision === "continue") {
      return resumeCheckpointConflict({ action: "resync" });
    }
    return resumeCheckpointConflict({ action: "force" });
  }

  if (target === "auth") {
    if (decision === "reject" || authAction === "cancel") {
      return resumeAuthOrDependency({ action: "cancel" });
    }
    if (authAction === "skip_fallback") {
      return resumeAuthOrDependency({ action: "skip_fallback" });
    }
    return resumeAuthOrDependency({ action: "connected" });
  }

  switch (decision) {
    case "clarify_answer":
      return resumeClarification({
        clarifyOrigin: "decide",
        hasPlanDraft: false,
      });
    case "approve":
      if (target === "mutation" || target === "destructive") {
        return resumeMutationApproval({ approved: true });
      }
      if (target === "external") {
        return resumeExternalSideEffect({ approved: true });
      }
      if (target === "grant") {
        return resumeGrantExpansion({ approved: true });
      }
      return resumePlanDecision({ decision: "approve" });
    case "reject":
      if (target === "mutation" || target === "destructive") {
        return resumeMutationApproval({ approved: false });
      }
      if (target === "external") {
        return resumeExternalSideEffect({ approved: false });
      }
      return resumePlanDecision({ decision: "reject" });
    case "expand_grant":
      return resumeGrantExpansion({ approved: true });
    case "steer":
      return resumePlanDecision({ decision: "steer" });
    case "continue":
    default:
      return resumeContinueDecision({ action: "continue" });
  }
}
