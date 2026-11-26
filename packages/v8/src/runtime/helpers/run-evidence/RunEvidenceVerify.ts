import type { RepoBuildState, VerificationResult } from "../../../modules/verification";
import type { RunEvidence } from "../../../engine/v8-engine/contracts";
import type { VerificationGateDecision } from "../verify";
import { clipEvidenceText, RUN_EVIDENCE_LIMITS } from "./ClampRunEvidence";
import {
  diagnosticKey,
  diagnosticToIssue,
  mergeIssues,
  upsertLedgerEntry,
} from "./RunEvidenceLedger";

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
      checkId: clipEvidenceText(check.checkId, RUN_EVIDENCE_LIMITS.checkId),
      kind: clipEvidenceText(check.kind, RUN_EVIDENCE_LIMITS.checkKind),
      outcome: clipEvidenceText(check.outcome, RUN_EVIDENCE_LIMITS.checkOutcome),
      summary: clipEvidenceText(check.summary, RUN_EVIDENCE_LIMITS.checkSummary),
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
      checkId: clipEvidenceText(check.checkId, RUN_EVIDENCE_LIMITS.checkId),
      kind: clipEvidenceText(check.kind, RUN_EVIDENCE_LIMITS.checkKind),
      outcome: clipEvidenceText(check.outcome, RUN_EVIDENCE_LIMITS.checkOutcome),
      summary: clipEvidenceText(check.summary, RUN_EVIDENCE_LIMITS.checkSummary),
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

