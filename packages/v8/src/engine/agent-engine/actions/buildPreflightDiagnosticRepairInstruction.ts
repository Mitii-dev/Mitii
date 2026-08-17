import type { VerificationDiagnostic } from "../../../modules/verification";

export interface PreflightDiagnosticRepairInstructionInput {
  diagnostics: readonly VerificationDiagnostic[];
  totalErrorCount: number;
  pathScopes: readonly string[];
  maxDiagnostics: number;
  maxChars: number;
}

export function buildPreflightDiagnosticRepairInstruction(
  input: PreflightDiagnosticRepairInstructionInput,
): string | undefined {
  const maxDiagnostics = Math.max(0, Math.floor(input.maxDiagnostics));
  const maxChars = Math.max(0, Math.floor(input.maxChars));
  if (maxDiagnostics === 0 || maxChars === 0) return undefined;

  const diagnostics = input.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .filter((diagnostic) => isPathInScopes(diagnostic.path, input.pathScopes))
    .slice(0, maxDiagnostics);
  if (diagnostics.length === 0) return undefined;

  const perDiagnosticChars = Math.floor(
    maxChars / Math.max(1, diagnostics.length + 4),
  );
  const lines = diagnostics.map((diagnostic) =>
    formatDiagnosticLine(diagnostic, perDiagnosticChars),
  );
  const remaining = Math.max(0, input.totalErrorCount - diagnostics.length);
  const body = [
    `Preflight verification already captured ${input.totalErrorCount} error(s). Use these scoped diagnostics as the first repair targets; do not restart broad exploration.`,
    "Patch listed files in a bounded batch. Read only the exact listed file if its current content is missing, then call apply_patch.",
    ...lines,
    remaining > 0
      ? `There are ${remaining} additional error(s); fix the listed batch first, then verify or continue.`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return clipText(body.join("\n"), maxChars);
}

function formatDiagnosticLine(
  diagnostic: VerificationDiagnostic,
  maxChars: number,
): string {
  const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
  const code = diagnostic.code ? ` ${diagnostic.code}` : "";
  return clipText(
    `- ${diagnostic.path}${line}${code}: ${diagnostic.message}`,
    maxChars,
  );
}

function isPathInScopes(path: string, scopes: readonly string[]): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedScopes = scopes.map(normalizePath).filter(Boolean);
  if (normalizedScopes.length === 0) return true;
  return normalizedScopes.some((scope) => {
    if (scope === ".") return true;
    return normalizedPath === scope || normalizedPath.startsWith(`${scope}/`);
  });
}

function normalizePath(value: string): string {
  return (
    value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^@+/, "")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "") || "."
  );
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}
