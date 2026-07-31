import type { DiagnosticItem } from "../contracts";

/**
 * Return diagnostics present in `after` but not in `baseline` (identity match).
 */
export function filterNewDiagnostics(params: {
  after: readonly DiagnosticItem[];
  baseline: readonly DiagnosticItem[];
}): DiagnosticItem[] {
  if (params.baseline.length === 0) {
    return [...params.after];
  }
  const baselineKeys = new Set(params.baseline.map(diagnosticIdentityKey));
  return params.after.filter(
    (diagnostic) => !baselineKeys.has(diagnosticIdentityKey(diagnostic)),
  );
}

function diagnosticIdentityKey(diagnostic: DiagnosticItem): string {
  return [
    diagnostic.path,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.startLine ?? "",
    diagnostic.startColumn ?? "",
    diagnostic.endLine ?? "",
    diagnostic.endColumn ?? "",
    diagnostic.source ?? "",
    diagnostic.code ?? "",
  ].join("\u001f");
}
