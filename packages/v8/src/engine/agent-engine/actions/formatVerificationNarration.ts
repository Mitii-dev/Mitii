import type { VerificationResult } from "../../../modules/verification";

import { truncateForEvent } from "./truncateForEvent";

export function formatVerificationFailureAnswer(params: {
  error: { code: string; message: string };
  verification?: VerificationResult;
  changedFiles: readonly string[];
  rolledBack: boolean;
}): string {
  const changed =
    params.changedFiles.length > 0
      ? ` Changed files: ${params.changedFiles.join(", ")}.`
      : "";
  const rollback = params.rolledBack
    ? " Any applied workspace changes were rolled back."
    : "";
  const evidence = params.verification
    ? ` Evidence: ${formatVerificationEvidence(params.verification)}`
    : "";
  return `I could not complete the change because required verification failed: ${params.error.message}.${rollback}${changed}${evidence}`;
}

export function formatVerificationEvidence(verification: VerificationResult): string {
  const checks = verification.checks
    .slice(0, 6)
    .map(
      (check) =>
        `${check.kind}/${check.outcome}: ${truncateForEvent(check.summary, 180)}`,
    );
  const diagnostics = verification.diagnostics.slice(0, 5).map((diag) => {
    const line = diag.startLine ? `:${diag.startLine}` : "";
    return `${diag.path}${line} ${diag.severity}: ${truncateForEvent(
      diag.message,
      220,
    )}`;
  });
  const warnings = verification.warnings
    .slice(0, 3)
    .map((warning) => `warning: ${truncateForEvent(warning, 180)}`);
  const parts = [
    `status=${verification.status}; reasons=${verification.reasonCodes.join(",")}`,
    ...checks,
    ...diagnostics,
    ...warnings,
  ];
  return parts.join("\n");
}
