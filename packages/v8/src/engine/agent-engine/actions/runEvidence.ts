import type { DiscoveryBrief, PlanArtifact } from "../../../modules/planning";
import type { RepoBuildState, VerificationResult } from "../../../modules/verification";
import type { ToolResult } from "../../tool-runtime";

import type { AgentReasonCode, AgentRunStatus, RunEvidence } from "../contracts";
import type { VerificationGateDecision } from "./decideVerificationGate";
import {
  DISCOVERY_PASS_POLICY,
  createDiscoveryObservationCollector,
} from "../internal/discoveryPass";
import { uniqueStrings } from "./planningContext";

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
  return evidence;
}

export function recordDiscoveryEvidence(
  evidence: RunEvidence,
  params: {
    brief: DiscoveryBrief;
    collector: ReturnType<typeof createDiscoveryObservationCollector>;
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
      params.collector.toolCalls >= DISCOVERY_PASS_POLICY.maxToolCalls
        ? ["Discovery stopped at the tool-call budget."]
        : [],
    capacity: {
      fileBudget: DISCOVERY_PASS_POLICY.maxFileReads,
      searchBudget: DISCOVERY_PASS_POLICY.maxSearches,
      toolCallBudget: DISCOVERY_PASS_POLICY.maxToolCalls,
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
    summary: params.summary || params.toolName,
    status: params.status,
    toolName: params.toolName,
    paths,
    issueIds: [],
    ...(params.at ? { at: params.at } : {}),
  });
  trimEvidence(evidence);
}

export function recordBuildStateDeltaEvidence(
  evidence: RunEvidence | undefined,
  params: { before?: RepoBuildState; after: RepoBuildState },
): void {
  if (!evidence) return;
  const beforeDiagnostics = params.before?.diagnostics ?? [];
  const afterDiagnostics = params.after.diagnostics;
  const afterKeys = new Set(afterDiagnostics.map(diagnosticKey));
  const beforeKeys = new Set(beforeDiagnostics.map(diagnosticKey));
  const issues = [
    ...beforeDiagnostics.map((diagnostic, index) =>
      diagnosticToIssue(diagnostic, {
        idPrefix: "before",
        index,
        status: afterKeys.has(diagnosticKey(diagnostic)) ? "remaining" : "fixed",
      }),
    ),
    ...afterDiagnostics
      .filter((diagnostic) => !beforeKeys.has(diagnosticKey(diagnostic)))
      .map((diagnostic, index) =>
        diagnosticToIssue(diagnostic, {
          idPrefix: "after",
          index,
          status: "remaining",
        }),
      ),
  ];
  evidence.issues = mergeIssues(evidence.issues, issues);
  evidence.verification = {
    status: params.after.summary.errorCount === 0 ? "passed" : "remaining",
    beforeErrorCount: params.before?.summary.errorCount,
    afterErrorCount: params.after.summary.errorCount,
    clearedErrorCount: Math.max(
      0,
      (params.before?.summary.errorCount ?? 0) - params.after.summary.errorCount,
    ),
    remainingIssueCount: params.after.summary.errorCount,
    checks: params.after.checks.slice(0, 32).map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      outcome: check.outcome,
      summary: check.summary,
    })),
    stopReason:
      params.after.summary.errorCount === 0
        ? "Build diagnostics show no remaining errors."
        : "Build diagnostics still show remaining errors.",
  };
}

export function recordVerificationEvidence(
  evidence: RunEvidence | undefined,
  params: { verification: VerificationResult; before?: RepoBuildState },
): void {
  if (!evidence) return;
  const diagnostics = params.verification.allDiagnostics ??
    params.verification.diagnostics;
  const issues = diagnostics.map((diagnostic, index) =>
    diagnosticToIssue(diagnostic, {
      idPrefix: "verify",
      index,
      status:
        diagnostic.severity === "error" || diagnostic.severity === "warning"
          ? "remaining"
          : "found",
    }),
  );
  evidence.issues = mergeIssues(evidence.issues, issues);
  evidence.verification = {
    status: params.verification.status,
    beforeErrorCount: params.before?.summary.errorCount,
    afterErrorCount: diagnostics.filter((diag) => diag.severity === "error")
      .length,
    clearedErrorCount:
      params.before?.summary.errorCount !== undefined
        ? Math.max(
            0,
            params.before.summary.errorCount -
              diagnostics.filter((diag) => diag.severity === "error").length,
          )
        : undefined,
    remainingIssueCount: diagnostics.filter(
      (diag) => diag.severity === "error" || diag.severity === "warning",
    ).length,
    checks: params.verification.checks.slice(0, 32).map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      outcome: check.outcome,
      summary: check.summary,
    })),
    stopReason:
      params.verification.status === "verified_success"
        ? "Verification checks passed."
        : "Verification did not fully pass.",
  };
}

export function recordStopEvidence(
  evidence: RunEvidence | undefined,
  acceptKind: Extract<VerificationGateDecision, { action: "accept" }>["acceptKind"],
): void {
  if (!evidence) return;
  const reason =
    acceptKind === "verified_success"
      ? "Completed because verification passed."
      : acceptKind === "skipped_not_required"
        ? "Completed because verification was not required."
        : acceptKind === "implemented_unverified"
          ? "Completed with implementation kept unverified by policy."
          : "Completed because verification was unavailable but allowed.";
  evidence.finalStopReason = reason;
  upsertLedgerEntry(evidence, {
    id: "verification-stop",
    kind: "stop",
    summary: reason,
    status: acceptKind,
    paths: [],
    issueIds: [],
  });
}

export function isSuccessfulVerificationToolResult(
  toolName: string,
  result: ToolResult,
): boolean {
  if (toolName !== "run_readonly_command" || result.status !== "succeeded") {
    return false;
  }
  const output = result.output;
  if (!output || typeof output !== "object") {
    return false;
  }
  const record = output as { argv?: unknown; exitCode?: unknown };
  if (record.exitCode !== 0 || !Array.isArray(record.argv)) {
    return false;
  }
  const argv = record.argv.filter(
    (part): part is string => typeof part === "string",
  );
  if (argv.length === 0) {
    return false;
  }
  const command = argv.join(" ").toLowerCase();
  return /\b(?:build|check|compile|lint|test|typecheck|tsc|vitest|jest|pytest|ctest)\b/.test(
    command,
  );
}

export function diagnosticToIssue(
  diagnostic: VerificationResult["diagnostics"][number],
  params: {
    idPrefix: string;
    index: number;
    status: RunEvidence["issues"][number]["status"];
  },
): RunEvidence["issues"][number] {
  return {
    id: `${params.idPrefix}-${params.index + 1}`,
    source: diagnostic.source ?? "diagnostic",
    path: diagnostic.path,
    message: diagnostic.message,
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
    status: params.status,
    ...(diagnostic.checkId
      ? { verificationEvidence: `check:${diagnostic.checkId}` }
      : {}),
  };
}

export function diagnosticKey(diagnostic: VerificationResult["diagnostics"][number]): string {
  return [
    diagnostic.path,
    diagnostic.startLine ?? "",
    diagnostic.source ?? "",
    diagnostic.code ?? "",
    diagnostic.message,
  ].join("|");
}

export function mergeIssues(
  current: RunEvidence["issues"],
  next: RunEvidence["issues"],
): RunEvidence["issues"] {
  const byKey = new Map<string, RunEvidence["issues"][number]>();
  for (const issue of current) {
    byKey.set(issueKey(issue), issue);
  }
  for (const issue of next) {
    byKey.set(issueKey(issue), issue);
  }
  return [...byKey.values()].slice(0, 500);
}

export function issueKey(issue: RunEvidence["issues"][number]): string {
  return [issue.path ?? "", issue.code ?? "", issue.message].join("|");
}

export function upsertLedgerEntry(
  evidence: RunEvidence,
  entry: RunEvidence["ledger"][number],
): void {
  const index = evidence.ledger.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    evidence.ledger[index] = entry;
  } else {
    evidence.ledger.push(entry);
  }
  trimEvidence(evidence);
}

export function trimEvidence(evidence: RunEvidence): void {
  evidence.ledger = evidence.ledger.slice(-500);
  evidence.issues = evidence.issues.slice(0, 500);
}

export function extractEvidencePaths(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const record = output as {
    changedFiles?: unknown;
    path?: unknown;
    argv?: unknown;
  };
  const paths: string[] = [];
  if (typeof record.path === "string") paths.push(record.path);
  if (Array.isArray(record.changedFiles)) {
    for (const item of record.changedFiles) {
      if (typeof item === "string") paths.push(item);
    }
  }
  return uniqueStrings(paths).slice(0, 40);
}

export function hasCheckpointOutput(output: unknown): boolean {
  return Boolean(
    output &&
      typeof output === "object" &&
      "checkpointId" in output &&
      typeof (output as { checkpointId?: unknown }).checkpointId === "string",
  );
}

export function isVerificationCommandOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const argv = (output as { argv?: unknown }).argv;
  if (!Array.isArray(argv)) return false;
  const command = argv
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return /\b(?:build|check|compile|lint|test|typecheck|tsc|vitest|jest|pytest|ctest)\b/.test(
    command,
  );
}
