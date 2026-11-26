import {
  runtimeResumeInputSchema,
  type RuntimeResumeInput,
} from "../contracts/input/RuntimeResumeInput";
import {
  runtimeRunResultSchema,
  type RuntimeRunResult,
} from "../contracts/output/RuntimeRunResult";
import {
  resumeClarification,
  resumeContinueDecision,
  resumeGrantExpansion,
  resumeMutationApproval,
  resumePlanDecision,
  type ResumePlan,
} from "../helpers/gates";
import { checkPlanFreshness } from "../helpers/build/CheckPlanFreshness";
import { readStoreSnapshotFromCheckpoint } from "../helpers/checkpoint/ReadStoreSnapshotFromCheckpoint";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
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
    clarifyAnswer: input.clarifyAnswer,
    guidance: input.guidance,
    approvedPlanFingerprint: input.approvedPlanFingerprint,
  });
  const decision = parsed.decision ?? "continue";
  const plan = mapResumeDecision(decision, parsed.target);

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
  const hydrateSnapshot = readStoreSnapshotFromCheckpoint(priorCheckpoint);

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
      ...(carry ? ["runtime_resume_from_session_carry"] : []),
      ...(priorCheckpoint ? ["runtime_resume_from_gate_checkpoint"] : []),
      "runtime_resume_completed",
    ],
  });
}

function mapResumeDecision(
  decision: NonNullable<RuntimeResumeInput["decision"]> | "continue",
  target?: RuntimeResumeInput["target"],
): ResumePlan {
  switch (decision) {
    case "clarify_answer":
      return resumeClarification({
        clarifyOrigin: "decide",
        hasPlanDraft: false,
      });
    case "approve":
      if (target === "mutation") {
        return resumeMutationApproval({ approved: true });
      }
      if (target === "grant") {
        return resumeGrantExpansion({ approved: true });
      }
      return resumePlanDecision({ decision: "approve" });
    case "reject":
      if (target === "mutation") {
        return resumeMutationApproval({ approved: false });
      }
      return resumePlanDecision({ decision: "reject" });
    case "expand_grant":
      return resumeGrantExpansion({ approved: true });
    case "continue":
    default:
      return resumeContinueDecision({ action: "continue" });
  }
}
