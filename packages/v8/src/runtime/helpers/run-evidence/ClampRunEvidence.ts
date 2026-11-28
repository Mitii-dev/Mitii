import type { RunEvidence } from "../../../engine/v8-engine/contracts";

/** Max lengths mirrored from `runEvidenceSchema`; keep in sync with RunEvidence.ts. */
export const RUN_EVIDENCE_LIMITS = {
  id: 120,
  source: 120,
  code: 120,
  path: 1_000,
  issueMessage: 800,
  verificationEvidence: 300,
  discoveryTarget: 1_000,
  discoveryCommand: 500,
  discoverySkipped: 500,
  discoveryStopReason: 500,
  planObjective: 1_000,
  planStepTitle: 500,
  planRef: 500,
  planVerification: 500,
  ledgerSummary: 800,
  ledgerStatus: 80,
  ledgerToolName: 120,
  verificationStatus: 80,
  checkId: 120,
  checkKind: 80,
  checkOutcome: 80,
  checkSummary: 500,
  verificationStopReason: 500,
  finalStopReason: 500,
} as const;

const ELLIPSIS = "…";
const EMPTY_PLACEHOLDER = "(empty)";

/** Truncate to `max` characters (ellipsis included); never returns "" for required text. */
export function clipEvidenceText(value: string, max: number): string {
  if (value.length === 0) return EMPTY_PLACEHOLDER.slice(0, max);
  if (value.length <= max) return value;
  if (max <= ELLIPSIS.length) return value.slice(0, max);
  return `${value.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

const clipOptional = (
  value: string | undefined,
  max: number,
): string | undefined =>
  value === undefined || value.length === 0
    ? undefined
    : clipEvidenceText(value, max);

const clipList = (values: readonly string[], max: number, count: number) =>
  values
    .filter((value) => value.length > 0)
    .slice(0, count)
    .map((value) => clipEvidenceText(value, max));

const withDefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;

/**
 * Producer-side guard: returns evidence whose strings and list sizes satisfy
 * `runEvidenceSchema`, so a long check id / summary can never invalidate the
 * final run result.
 */
export function clampRunEvidence(evidence: RunEvidence): RunEvidence {
  const L = RUN_EVIDENCE_LIMITS;
  const out: RunEvidence = {
    issues: evidence.issues.slice(0, 500).map((issue) =>
      withDefined({
        ...issue,
        id: clipEvidenceText(issue.id, L.id),
        source: clipEvidenceText(issue.source, L.source),
        path: clipOptional(issue.path, L.path),
        message: clipEvidenceText(issue.message, L.issueMessage),
        code: clipOptional(issue.code, L.code),
        linkedPlanStepId: clipOptional(issue.linkedPlanStepId, L.id),
        verificationEvidence: clipOptional(
          issue.verificationEvidence,
          L.verificationEvidence,
        ),
      }),
    ),
    ledger: evidence.ledger.slice(-500).map((entry) =>
      withDefined({
        ...entry,
        id: clipEvidenceText(entry.id, L.id),
        summary: clipEvidenceText(entry.summary, L.ledgerSummary),
        status: clipOptional(entry.status, L.ledgerStatus),
        toolName: clipOptional(entry.toolName, L.ledgerToolName),
        planStepId: clipOptional(entry.planStepId, L.id),
        issueIds: clipList(entry.issueIds, L.id, 20),
        paths: clipList(entry.paths, L.path, 40),
      }),
    ),
  };
  const finalStopReason = clipOptional(
    evidence.finalStopReason,
    L.finalStopReason,
  );
  if (finalStopReason) out.finalStopReason = finalStopReason;

  if (evidence.discovery) {
    const discovery = evidence.discovery;
    out.discovery = withDefined({
      ...discovery,
      target: clipEvidenceText(discovery.target, L.discoveryTarget),
      filesRead: clipList(discovery.filesRead, L.path, 80),
      searches: clipList(discovery.searches, L.path, 80),
      commands: clipList(discovery.commands, L.discoveryCommand, 32),
      skipped: clipList(discovery.skipped, L.discoverySkipped, 32),
      stopReason: clipEvidenceText(
        discovery.stopReason,
        L.discoveryStopReason,
      ),
    });
  }

  if (evidence.plan) {
    const plan = evidence.plan;
    out.plan = {
      ...plan,
      objective: clipEvidenceText(plan.objective, L.planObjective),
      steps: plan.steps.slice(0, 80).map((step) =>
        withDefined({
          ...step,
          id: clipEvidenceText(step.id, L.id),
          title: clipEvidenceText(step.title, L.planStepTitle),
          targetRefs: clipList(step.targetRefs, L.planRef, 32),
          evidenceRefs: clipList(step.evidenceRefs, L.planRef, 32),
          verification: clipOptional(step.verification, L.planVerification),
        }),
      ),
    };
  }

  if (evidence.verification) {
    const verification = evidence.verification;
    out.verification = withDefined({
      ...verification,
      status: clipEvidenceText(verification.status, L.verificationStatus),
      checks: verification.checks.slice(0, 32).map((check) => ({
        checkId: clipEvidenceText(check.checkId, L.checkId),
        kind: clipEvidenceText(check.kind, L.checkKind),
        outcome: clipEvidenceText(check.outcome, L.checkOutcome),
        summary: clipEvidenceText(check.summary, L.checkSummary),
      })),
      stopReason: clipOptional(
        verification.stopReason,
        L.verificationStopReason,
      ),
    });
  }
  return out;
}
