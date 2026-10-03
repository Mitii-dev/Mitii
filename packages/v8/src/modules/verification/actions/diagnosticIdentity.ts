import type { VerificationDiagnostic } from "../contracts";
import { normalizeVerificationPath } from "../patterns";

/**
 * Stable identity for before→after / baseline diagnostic compare.
 * Path case and message whitespace are normalized so the same defect is
 * not counted as "new" across capture formats.
 */
export function diagnosticIdentityKey(
  diagnostic: Pick<
    VerificationDiagnostic,
    | "path"
    | "severity"
    | "message"
    | "startLine"
    | "startColumn"
    | "endLine"
    | "endColumn"
    | "source"
    | "code"
  >,
): string {
  return [
    normalizeVerificationPath(diagnostic.path).toLowerCase(),
    diagnostic.severity,
    diagnostic.message.replace(/\s+/g, " ").trim(),
    diagnostic.startLine ?? "",
    diagnostic.startColumn ?? "",
    diagnostic.endLine ?? "",
    diagnostic.endColumn ?? "",
    diagnostic.source ?? "",
    diagnostic.code ?? "",
  ].join("\u001f");
}
