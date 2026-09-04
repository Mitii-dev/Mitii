import { expect } from "vitest";

import type { ExecutionDecision } from "../../contracts";
import type { DecisionExpectation } from "../fixtures/decisionFixtureTypes";

export function assertDecisionExpectation(
  decision: ExecutionDecision,
  expected: DecisionExpectation,
  caseId: string,
): void {
  expect(decision.route, caseId).toBe(expected.route);

  if (expected.runDisposition !== undefined) {
    expect(decision.runDisposition, caseId).toBe(expected.runDisposition);
  }
  if (expected.planningDepth !== undefined) {
    expect(decision.planningDepth, caseId).toBe(expected.planningDepth);
  }
  if (expected.planGate !== undefined) {
    expect(decision.planGate, caseId).toBe(expected.planGate);
  }
  if (expected.maximumWorkspaceEffect !== undefined) {
    expect(decision.toolGrant.maximumWorkspaceEffect, caseId).toBe(
      expected.maximumWorkspaceEffect,
    );
  }
  if (expected.approvalMode !== undefined) {
    expect(decision.toolGrant.approvalMode, caseId).toBe(expected.approvalMode);
  }
  if (expected.pathScopes !== undefined) {
    expect(decision.toolGrant.pathScopes, caseId).toEqual(
      expect.arrayContaining(expected.pathScopes),
    );
  }
  if (expected.mutationPathScopes !== undefined) {
    expect(decision.toolGrant.mutationPathScopes ?? [], caseId).toEqual(
      expect.arrayContaining(expected.mutationPathScopes),
    );
  }
  for (const tool of expected.allowedToolsIncludes ?? []) {
    expect(decision.toolGrant.allowedTools, `${caseId}:${tool}`).toContain(tool);
  }
  for (const tool of expected.allowedToolsExcludes ?? []) {
    expect(decision.toolGrant.allowedTools, `${caseId}:${tool}`).not.toContain(
      tool,
    );
  }
  for (const code of expected.reasonCodesIncludes ?? []) {
    expect(decision.reasonCodes, `${caseId}:${code}`).toContain(code);
  }
  for (const code of expected.reasonCodesExcludes ?? []) {
    expect(decision.reasonCodes, `${caseId}:${code}`).not.toContain(code);
  }
  for (const warning of expected.warningsIncludes ?? []) {
    expect(decision.warnings.join("\n"), caseId).toContain(warning);
  }
  if (expected.verificationRequired !== undefined) {
    expect(decision.verification.required, caseId).toBe(
      expected.verificationRequired,
    );
  }
  for (const evidence of expected.verificationEvidenceIncludes ?? []) {
    expect(decision.verification.minimumEvidence, caseId).toContain(evidence);
  }
  if (expected.forbidVisiblePlan) {
    expect(decision.planningDepth, caseId).not.toBe("visible");
  }
  if (expected.maximumWorkspaceEffect === "read") {
    expect(decision.toolGrant.allowedEffects, caseId).not.toContain(
      "workspace_write",
    );
  }
}
