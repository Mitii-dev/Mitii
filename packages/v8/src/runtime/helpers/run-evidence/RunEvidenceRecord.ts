import type { DiscoveryBrief, PlanArtifact } from "../../../modules/planning";
import type {
  AgentReasonCode,
  AgentRunStatus,
  RunEvidence,
} from "../../../engine/v8-engine/contracts";
import {
  clampRunEvidence,
  clipEvidenceText,
  RUN_EVIDENCE_LIMITS,
} from "./ClampRunEvidence";
import { uniqueStrings } from "../plan-discovery/PlanningPathUtils";
import {
  extractEvidencePaths,
  hasCheckpointOutput,
  isVerificationCommandOutput,
  trimEvidence,
  upsertLedgerEntry,
} from "./RunEvidenceLedger";

/** Slice of discovery collector needed for evidence recording (avoids engine internals). */
export interface DiscoveryEvidenceCollectorSlice {
  searchHits: ReadonlyArray<{ path: string }>;
  toolCalls: number;
  fileReads: number;
  searches: number;
  budget: {
    maxToolCalls: number;
    maxFileReads: number;
    maxSearches: number;
  };
}

export function createInitialRunEvidence(objective: string): RunEvidence {
  return {
    issues: [],
    ledger: [
      {
        id: "run-start",
        kind: "tool",
        summary: `Run objective: ${objective.slice(0, 780)}`,
        paths: [],
        issueIds: [],
      },
    ],
  };
}

export function finalizeRunEvidence(params: {
  evidence: RunEvidence;
  status: AgentRunStatus;
  reasonCodes: readonly AgentReasonCode[];
}): RunEvidence {
  const evidence = params.evidence;
  if (!evidence.finalStopReason) {
    if (params.status === "completed") {
      if (params.reasonCodes.includes("verification_passed")) {
        evidence.finalStopReason =
          "Completed because required verification passed after edits.";
      } else if (params.reasonCodes.includes("plan_mode_completed")) {
        evidence.finalStopReason =
          "Completed because Plan mode produced a structured plan.";
      } else {
        evidence.finalStopReason =
          "Completed because the agent produced an answer within the approved scope.";
      }
    } else if (params.status === "budget_exhausted") {
      evidence.finalStopReason = "Stopped because the run budget was exhausted.";
    } else if (params.status === "failed") {
      evidence.finalStopReason =
        "Stopped because execution or required verification failed.";
    } else if (params.status === "suspended") {
      evidence.finalStopReason =
        "Suspended because user approval or clarification is required.";
    } else if (params.status === "cancelled") {
      evidence.finalStopReason = "Stopped because the run was cancelled.";
    }
  }
  if (evidence.finalStopReason) {
    upsertLedgerEntry(evidence, {
      id: "final-stop",
      kind: "stop",
      summary: evidence.finalStopReason,
      status: params.status,
      paths: [],
      issueIds: [],
    });
  }
  return clampRunEvidence(evidence);
}

export function recordDiscoveryEvidence(
  evidence: RunEvidence,
  params: {
    brief: DiscoveryBrief;
    collector: DiscoveryEvidenceCollectorSlice;
    failed: boolean;
  },
): void {
  evidence.discovery = {
    target: params.brief.objective,
    filesRead: uniqueStrings(params.brief.filesRead.map((file) => file.path)),
    searches: uniqueStrings(params.collector.searchHits.map((hit) => hit.path)),
    commands: uniqueStrings(
      params.brief.verificationHints
        .map((hint) => hint.command)
        .filter((value): value is string => Boolean(value)),
    ),
    skipped:
      params.collector.toolCalls >= params.collector.budget.maxToolCalls
        ? ["Discovery stopped at the tool-call budget."]
        : [],
    capacity: {
      fileBudget: params.collector.budget.maxFileReads,
      searchBudget: params.collector.budget.maxSearches,
      toolCallBudget: params.collector.budget.maxToolCalls,
      filesRead: params.collector.fileReads,
      searchesRun: params.collector.searches,
      toolCallsUsed: params.collector.toolCalls,
    },
    stopReason: params.failed
      ? "Discovery stopped with low confidence and no concrete change surface."
      : "Discovery stopped after identifying enough evidence for planning.",
    confidence: params.brief.confidence,
    surfaceCount: params.brief.proposedChangeSurfaces.length,
  };
  upsertLedgerEntry(evidence, {
    id: "discovery",
    kind: "discovery",
    summary: `${params.brief.confidence} confidence; ${params.brief.filesRead.length} files; ${params.brief.proposedChangeSurfaces.length} change surfaces.`,
    paths: evidence.discovery.filesRead.slice(0, 40),
    issueIds: [],
  });
}

export function recordPlanEvidence(evidence: RunEvidence, plan: PlanArtifact): void {
  const reviewedRefs = plan.contextReviewed.map((ref) => ref.ref);
  const steps = plan.phases.flatMap((phase) =>
    phase.steps.map((step) => {
      const evidenceRefs = uniqueStrings([
        ...step.targetRefs,
        ...reviewedRefs.filter((ref) =>
          step.targetRefs.some(
            (target) => ref.includes(target) || target.includes(ref),
          ),
        ),
      ]).slice(0, 32);
      return {
        id: step.id,
        title: step.intent || step.actionSummary,
        targetRefs: step.targetRefs,
        evidenceRefs,
        ...(step.verification ? { verification: step.verification } : {}),
        status: "pending" as const,
      };
    }),
  );
  evidence.plan = {
    objective: plan.objective,
    stepCount: steps.length,
    steps,
    evidenceLinkedStepCount: steps.filter(
      (step) => step.evidenceRefs.length > 0 || step.verification,
    ).length,
  };
  upsertLedgerEntry(evidence, {
    id: "plan",
    kind: "plan",
    summary: `Plan has ${plan.phases.length} phases and ${steps.length} executable steps.`,
    paths: uniqueStrings(steps.flatMap((step) => step.targetRefs)).slice(0, 40),
    issueIds: [],
  });
}

/** Stamp durable notebook completions onto run-evidence plan steps. */
export function markPlanEvidenceStepsDone(
  evidence: RunEvidence | undefined,
  stepIds: readonly string[],
): void {
  if (!evidence?.plan || stepIds.length === 0) {
    return;
  }
  const done = new Set(stepIds);
  for (const step of evidence.plan.steps) {
    if (done.has(step.id) && step.status !== "done") {
      step.status = "done";
    }
  }
}

export function recordToolEvidence(
  evidence: RunEvidence | undefined,
  params: {
    toolName: string;
    status: string;
    summary?: string;
    output?: unknown;
    at?: string;
  },
): void {
  if (!evidence) return;
  const paths = extractEvidencePaths(params.output);
  const kind =
    hasCheckpointOutput(params.output)
      ? "edit"
      : params.toolName === "run_readonly_command" &&
          isVerificationCommandOutput(params.output)
        ? "verification"
        : "tool";
  evidence.ledger.push({
    id: `tool-${evidence.ledger.length + 1}`,
    kind,
    summary: clipEvidenceText(
      params.summary || params.toolName,
      RUN_EVIDENCE_LIMITS.ledgerSummary,
    ),
    status: params.status,
    toolName: params.toolName,
    paths,
    issueIds: [],
    ...(params.at ? { at: params.at } : {}),
  });
  trimEvidence(evidence);
}

