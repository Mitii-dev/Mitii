import type { ProjectDescriptor } from "../../repository-state";
import type {
  VerificationCheckResult,
  VerificationDiagnostic,
} from "../contracts";
import { DEFAULT_MAX_DIAGNOSTICS } from "../defaults";

/**
 * Normalize diagnostics from Tool Runtime read_diagnostics output and from
 * common compiler/test text patterns in check stdout/stderr.
 */
export function normalizeDiagnostics(params: {
  checks: readonly VerificationCheckResult[];
  toolOutputs: ReadonlyMap<string, unknown>;
  projects?: readonly ProjectDescriptor[];
  baselineDiagnostics?: readonly VerificationDiagnostic[];
}): VerificationDiagnostic[] {
  const diagnostics: VerificationDiagnostic[] = [];
  const projectRoots = buildProjectRootLookup(params.projects ?? []);

  for (const check of params.checks) {
    if (!check.toolCallId) continue;
    const output = params.toolOutputs.get(check.toolCallId);
    if (!output) continue;

    const projectRoot = check.projectId
      ? projectRoots.get(check.projectId)
      : undefined;

    if (check.kind === "diagnostics") {
      diagnostics.push(
        ...fromDiagnosticsTool(check.checkId, output).map((diagnostic) =>
          resolveDiagnosticPath(diagnostic, projectRoot),
        ),
      );
      continue;
    }

    if (check.kind === "diff_review") {
      continue;
    }

    diagnostics.push(
      ...fromCompilerText(check.checkId, extractCombinedText(output)).map(
        (diagnostic) => resolveDiagnosticPath(diagnostic, projectRoot),
      ),
    );
  }

  return filterBaselineDiagnostics({
    diagnostics,
    baselineDiagnostics: params.baselineDiagnostics,
  }).slice(0, DEFAULT_MAX_DIAGNOSTICS);
}

function buildProjectRootLookup(
  projects: readonly ProjectDescriptor[],
): Map<string, string> {
  return new Map(
    projects.map((project) => [
      project.projectId,
      normalizeSlashes(project.rootPath).replace(/\/$/, ""),
    ]),
  );
}

/**
 * Diagnostic paths from compilers/linters are reported relative to the
 * directory the check ran in (the project root), not the workspace root.
 * Join them with the check's project root so downstream scope matching
 * (e.g. planning's ask-scope filter) compares like with like.
 */
function resolveDiagnosticPath(
  diagnostic: VerificationDiagnostic,
  projectRoot: string | undefined,
): VerificationDiagnostic {
  if (!projectRoot || diagnostic.path === "<test>") {
    return diagnostic;
  }
  const path = normalizeSlashes(diagnostic.path);
  if (path === projectRoot || path.startsWith(`${projectRoot}/`)) {
    return diagnostic;
  }
  return { ...diagnostic, path: `${projectRoot}/${path}` };
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function filterBaselineDiagnostics(params: {
  diagnostics: readonly VerificationDiagnostic[];
  baselineDiagnostics?: readonly VerificationDiagnostic[];
}): VerificationDiagnostic[] {
  if (!params.baselineDiagnostics || params.baselineDiagnostics.length === 0) {
    return [...params.diagnostics];
  }

  const baselineKeys = new Set(
    params.baselineDiagnostics.map(diagnosticIdentityKey),
  );
  return params.diagnostics.filter(
    (diagnostic) => !baselineKeys.has(diagnosticIdentityKey(diagnostic)),
  );
}

function fromDiagnosticsTool(
  checkId: string,
  output: unknown,
): VerificationDiagnostic[] {
  if (!output || typeof output !== "object") return [];
  const diagnostics = (output as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) return [];

  const result: VerificationDiagnostic[] = [];
  for (const item of diagnostics) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.message !== "string") {
      continue;
    }
    const severity = normalizeSeverity(record.severity);
    result.push({
      path: record.path,
      severity,
      message: record.message,
      startLine:
        typeof record.startLine === "number" ? record.startLine : undefined,
      startColumn:
        typeof record.startColumn === "number" ? record.startColumn : undefined,
      endLine: typeof record.endLine === "number" ? record.endLine : undefined,
      endColumn:
        typeof record.endColumn === "number" ? record.endColumn : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
      code:
        typeof record.code === "string" || typeof record.code === "number"
          ? String(record.code)
          : undefined,
      checkId,
    });
  }
  return result;
}

function fromCompilerText(
  checkId: string,
  text: string,
): VerificationDiagnostic[] {
  if (!text.trim()) return [];
  const result: VerificationDiagnostic[] = [];

  // TypeScript / ESLint stylish: path(line,col): error TS1234: message
  const tsPattern =
    /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+([A-Z]+\d+):\s+(.+)$/gm;
  for (const match of text.matchAll(tsPattern)) {
    result.push({
      path: match[1]!.trim(),
      severity: normalizeSeverity(match[4]),
      message: match[6]!.trim(),
      startLine: Number(match[2]),
      startColumn: Number(match[3]),
      code: match[5],
      source: "compiler",
      checkId,
    });
  }

  // Generic path:line:col: message
  const generic =
    /^(.+?):(\d+)(?::(\d+))?:\s*(error|warning|ERROR|WARNING)?\s*:?\s*(.+)$/gm;
  if (result.length === 0) {
    for (const match of text.matchAll(generic)) {
      result.push({
        path: match[1]!.trim(),
        severity: normalizeSeverity(match[4] ?? "error"),
        message: match[5]!.trim(),
        startLine: Number(match[2]),
        startColumn: match[3] ? Number(match[3]) : undefined,
        source: "compiler",
        checkId,
      });
    }
  }

  // pytest: path:line: Failure/Error
  const pytest =
    /^((?:\/|\w).*?\.py):(\d+):\s*(Failure|Error|FAILED)\b[:\s]*(.*)$/gm;
  for (const match of text.matchAll(pytest)) {
    result.push({
      path: match[1]!.trim(),
      severity: "error",
      message: (match[4] || match[3] || "test failure").trim(),
      startLine: Number(match[2]),
      source: "pytest",
      checkId,
    });
  }

  // Jest / Vitest FAIL  path > suite
  const jestFail = /^\s*(?:FAIL|✗|×)\s+(.+\.(?:test|spec)\.[jt]sx?)\b.*$/gm;
  for (const match of text.matchAll(jestFail)) {
    result.push({
      path: match[1]!.trim(),
      severity: "error",
      message: "Test suite failed",
      source: "test-runner",
      checkId,
    });
  }

  // AssertionError / Expected lines without path — attach as synthetic diagnostic
  if (result.length === 0) {
    const assertion = text.match(
      /(?:AssertionError|Expected|Expected:|Received:).{0,200}/,
    );
    if (assertion) {
      result.push({
        path: "<test>",
        severity: "error",
        message: assertion[0]!.trim().slice(0, 500),
        source: "test-runner",
        checkId,
      });
    }
  }

  return result;
}

function normalizeSeverity(
  value: unknown,
): VerificationDiagnostic["severity"] {
  const text = String(value ?? "error").toLowerCase();
  if (text === "warning" || text === "warn") return "warning";
  if (text === "info" || text === "information") return "info";
  if (text === "hint") return "hint";
  return "error";
}

function extractCombinedText(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const record = output as { stdout?: unknown; stderr?: unknown };
  return [record.stdout, record.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function diagnosticIdentityKey(diagnostic: VerificationDiagnostic): string {
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
