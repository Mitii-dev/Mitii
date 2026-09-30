import type { ToolGrant } from "../../decision-policy";
import type { RepositoryStateReference } from "../../repository-state";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../engine/tool-runtime";

import type {
  VerificationCheckOutcome,
  VerificationCheckResult,
  VerificationSyntaxPort,
  VerificationToolExecutorPort,
} from "../contracts";
import { SYNTAX_PORT_EVIDENCE } from "../contracts";
import { MISSING_TOOL_PATTERNS, COMPILER_DIAGNOSTIC_EVIDENCE } from "../policy";
import type { DiscoveredCheckCandidate } from "../internal/discovery";

const MISCONFIGURED_PORT_PATTERNS =
  /\b(misconfigured_ports|DiagnosticsPort is required|GitPort is required)\b/i;

export interface ExecuteChecksResult {
  checks: VerificationCheckResult[];
  toolOutputs: Map<string, unknown>;
  cancelled: boolean;
  warnings: string[];
}

export async function executeChecks(params: {
  candidates: readonly DiscoveredCheckCandidate[];
  grant: ToolGrant;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference;
  tools: VerificationToolExecutorPort;
  /** Optional host tree-sitter syntax gate. */
  syntax?: VerificationSyntaxPort;
  signal?: AbortSignal;
}): Promise<ExecuteChecksResult> {
  const checks: VerificationCheckResult[] = [];
  const toolOutputs = new Map<string, unknown>();
  const warnings: string[] = [];
  let cancelled = false;
  /** Cache PATH probes per binary so mayBeUnavailable checks share one probe. */
  const binaryCache = new Map<string, boolean>();

  for (const [index, candidate] of params.candidates.entries()) {
    if (params.signal?.aborted) {
      cancelled = true;
      checks.push({
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "cancelled",
        summary: "Verification cancelled before check execution.",
      });
      for (const remaining of params.candidates.slice(index + 1)) {
        checks.push({
          checkId: remaining.checkId,
          kind: remaining.kind,
          projectId: remaining.projectId,
          label: remaining.label,
          argv: remaining.argv,
          evidenceSource: remaining.evidenceSource,
          outcome: "cancelled",
          summary: "Skipped because verification was cancelled.",
        });
      }
      break;
    }

    if (candidate.evidenceSource === SYNTAX_PORT_EVIDENCE) {
      const callId = `verify-${index + 1}-${candidate.checkId}`;
      const started = Date.now();
      const syntaxResult = await executeSyntaxPortCheck({
        candidate,
        callId,
        started,
        syntax: params.syntax,
        workspaceRoot: params.workspaceRoot,
        signal: params.signal,
      });
      if (syntaxResult.output !== undefined) {
        toolOutputs.set(callId, syntaxResult.output);
      }
      checks.push(syntaxResult.check);
      if (syntaxResult.warning) {
        warnings.push(syntaxResult.warning);
      }
      if (syntaxResult.check.outcome === "cancelled") {
        cancelled = true;
        for (const remaining of params.candidates.slice(index + 1)) {
          checks.push({
            checkId: remaining.checkId,
            kind: remaining.kind,
            projectId: remaining.projectId,
            label: remaining.label,
            argv: remaining.argv,
            evidenceSource: remaining.evidenceSource,
            outcome: "cancelled",
            summary: "Skipped because verification was cancelled.",
          });
        }
        break;
      }
      continue;
    }

    if (!params.grant.allowedTools.includes(candidate.toolName)) {
      checks.push({
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "unavailable",
        summary: `Tool "${candidate.toolName}" is not in the grant.`,
      });
      warnings.push(
        `Check "${candidate.checkId}" unavailable: tool "${candidate.toolName}" not granted.`,
      );
      continue;
    }

    const binaryMissing = await probeBinaryMissing({
      candidate,
      grant: params.grant,
      workspaceRoot: params.workspaceRoot,
      pinnedState: params.pinnedState,
      tools: params.tools,
      signal: params.signal,
      binaryCache,
      index,
    });
    if (binaryMissing) {
      checks.push({
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "unavailable",
        summary: `Required tool appears missing (preflight): ${candidate.argv?.[0] ?? candidate.toolName}.`,
      });
      warnings.push(
        `Check "${candidate.checkId}" unavailable: binary "${candidate.argv?.[0]}" not found on PATH.`,
      );
      continue;
    }

    const callId = `verify-${index + 1}-${candidate.checkId}`;
    const started = Date.now();
    const result = await params.tools.execute(
      {
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId,
        toolName: candidate.toolName,
        arguments: candidate.toolArguments,
        grant: params.grant,
        workspaceRoot: params.workspaceRoot,
        pinnedState: params.pinnedState,
      },
      { signal: params.signal },
    );

    const durationMs = Date.now() - started;
    if (result.output !== undefined) {
      toolOutputs.set(callId, result.output);
    }
    let outcome = mapToolResultToOutcome(result.status, result.output);
    const summary = summarizeToolResult(candidate, result.status, result.output);
    const outputText = extractOutputText(result.output);
    const warningText = (result.warnings ?? []).join("\n");
    const evidenceText = `${outputText}\n${warningText}`;

    // Mutating formatters often exit non-zero after rewriting with no
    // diagnostics — that is not a defect in the change under review.
    if (
      candidate.kind === "format" &&
      outcome === "failed" &&
      !COMPILER_DIAGNOSTIC_EVIDENCE.test(evidenceText) &&
      !hasParsedDiagnosticSignal(evidenceText)
    ) {
      checks.push({
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "passed",
        exitCode: extractExitCode(result.output),
        durationMs,
        summary: `${candidate.label} exited non-zero without diagnostics (treated as format rewrite, not a defect).`,
        toolCallId: callId,
      });
      warnings.push(
        `Check "${candidate.checkId}" format non-zero exit ignored (no diagnostic evidence).`,
      );
      continue;
    }

    if (
      outcome === "failed" &&
      !COMPILER_DIAGNOSTIC_EVIDENCE.test(evidenceText) &&
      (MISSING_TOOL_PATTERNS.test(evidenceText) ||
        MISCONFIGURED_PORT_PATTERNS.test(evidenceText))
    ) {
      checks.push({
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "unavailable",
        exitCode: extractExitCode(result.output),
        durationMs,
        summary: `Required tool appears missing: ${summary}`,
        toolCallId: callId,
      });
      warnings.push(
        `Check "${candidate.checkId}" degraded to unavailable (missing tool evidence).`,
      );
      continue;
    }

    if (outcome === "cancelled") {
      cancelled = true;
    }

    checks.push({
      checkId: candidate.checkId,
      kind: candidate.kind,
      projectId: candidate.projectId,
      label: candidate.label,
      argv: candidate.argv,
      evidenceSource: candidate.evidenceSource,
      outcome,
      exitCode: extractExitCode(result.output),
      durationMs,
      summary,
      toolCallId: callId,
    });

    if (cancelled) {
      for (const remaining of params.candidates.slice(index + 1)) {
        checks.push({
          checkId: remaining.checkId,
          kind: remaining.kind,
          projectId: remaining.projectId,
          label: remaining.label,
          argv: remaining.argv,
          evidenceSource: remaining.evidenceSource,
          outcome: "cancelled",
          summary: "Skipped because verification was cancelled.",
        });
      }
      break;
    }
  }

  return { checks, toolOutputs, cancelled, warnings };
}

async function executeSyntaxPortCheck(params: {
  candidate: DiscoveredCheckCandidate;
  callId: string;
  started: number;
  syntax?: VerificationSyntaxPort;
  workspaceRoot: string;
  signal?: AbortSignal;
}): Promise<{
  check: VerificationCheckResult;
  output?: unknown;
  warning?: string;
}> {
  const { candidate, callId, started } = params;
  if (!params.syntax) {
    return {
      check: {
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "unavailable",
        durationMs: Date.now() - started,
        summary: "VerificationSyntaxPort is not configured.",
        toolCallId: callId,
      },
      warning: `Check "${candidate.checkId}" unavailable: syntax port not configured.`,
    };
  }

  if (params.signal?.aborted) {
    return {
      check: {
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "cancelled",
        durationMs: Date.now() - started,
        summary: "Verification cancelled before syntax check.",
        toolCallId: callId,
      },
    };
  }

  const paths = extractSyntaxPaths(candidate.toolArguments);
  try {
    const result = await params.syntax.checkFiles({
      workspaceRoot: params.workspaceRoot,
      paths,
      signal: params.signal,
    });
    const findings = result.findings ?? [];
    const output = {
      findings,
      warnings: result.warnings ?? [],
    };
    const outcome: VerificationCheckOutcome =
      findings.length === 0 ? "passed" : "failed";
    return {
      check: {
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome,
        exitCode: findings.length === 0 ? 0 : 1,
        durationMs: Date.now() - started,
        summary:
          findings.length === 0
            ? `${candidate.label}: no syntax errors.`
            : `${candidate.label}: ${findings.length} syntax finding(s).`,
        toolCallId: callId,
      },
      output,
      warning:
        result.warnings && result.warnings.length > 0
          ? result.warnings.join("; ")
          : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      check: {
        checkId: candidate.checkId,
        kind: candidate.kind,
        projectId: candidate.projectId,
        label: candidate.label,
        argv: candidate.argv,
        evidenceSource: candidate.evidenceSource,
        outcome: "unavailable",
        durationMs: Date.now() - started,
        summary: `Syntax port failed: ${message}`,
        toolCallId: callId,
      },
      warning: `Check "${candidate.checkId}" unavailable: ${message}`,
    };
  }
}

function extractSyntaxPaths(toolArguments: unknown): string[] {
  if (!toolArguments || typeof toolArguments !== "object") {
    return [];
  }
  const paths = (toolArguments as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) {
    return [];
  }
  return paths.filter((path): path is string => typeof path === "string");
}

/**
 * Package managers are assumed present when the grant allows
 * `run_readonly_command`. Probe only language binaries marked
 * `mayBeUnavailable` (ruff, python3, go, bash, …).
 */
const SKIP_PATH_PROBE = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "node",
]);

async function probeBinaryMissing(params: {
  candidate: DiscoveredCheckCandidate;
  grant: ToolGrant;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference;
  tools: VerificationToolExecutorPort;
  signal?: AbortSignal;
  binaryCache: Map<string, boolean>;
  index: number;
}): Promise<boolean> {
  if (!params.candidate.mayBeUnavailable) {
    return false;
  }
  if (params.candidate.toolName !== "run_readonly_command") {
    return false;
  }
  if (!params.grant.allowedTools.includes("run_readonly_command")) {
    return false;
  }
  const binary = params.candidate.argv?.[0]?.trim();
  if (!binary || SKIP_PATH_PROBE.has(binary)) {
    return false;
  }
  if (params.binaryCache.has(binary)) {
    return params.binaryCache.get(binary) === true;
  }

  const probe = await params.tools.execute(
    {
      schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
      callId: `verify-probe-${params.index + 1}-${binary}`,
      toolName: "run_readonly_command",
      arguments: { argv: [binary, "--version"] },
      grant: params.grant,
      workspaceRoot: params.workspaceRoot,
      pinnedState: params.pinnedState,
    },
    { signal: params.signal },
  );
  const evidenceText = `${extractOutputText(probe.output)}\n${(probe.warnings ?? []).join("\n")}`;
  const missing =
    MISSING_TOOL_PATTERNS.test(evidenceText) ||
    MISCONFIGURED_PORT_PATTERNS.test(evidenceText) ||
    (probe.status === "failed" &&
      extractExitCode(probe.output) === null &&
      MISSING_TOOL_PATTERNS.test(evidenceText));

  // Non-zero --version still means the binary exists on PATH.
  const unavailable =
    missing ||
    (probe.status === "failed" &&
      /command not found|enoent|not recognized/i.test(evidenceText));

  params.binaryCache.set(binary, unavailable);
  return unavailable;
}

function mapToolResultToOutcome(
  status: string,
  output: unknown,
): VerificationCheckOutcome {
  if (status === "cancelled") return "cancelled";
  if (status === "timed_out") return "timed_out";
  if (status === "rejected" || status === "failed") return "failed";
  if (status === "succeeded") {
    const exitCode = extractExitCode(output);
    if (exitCode === null || exitCode === undefined) {
      // diagnostics / git tools succeed without exit codes
      return "passed";
    }
    return exitCode === 0 ? "passed" : "failed";
  }
  return "failed";
}

function extractExitCode(output: unknown): number | null | undefined {
  if (
    output &&
    typeof output === "object" &&
    "exitCode" in output &&
    (typeof (output as { exitCode: unknown }).exitCode === "number" ||
      (output as { exitCode: unknown }).exitCode === null)
  ) {
    return (output as { exitCode: number | null }).exitCode;
  }
  return undefined;
}

function extractOutputText(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const record = output as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const parts = [record.stdout, record.stderr, record.message]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  return parts;
}

function hasParsedDiagnosticSignal(text: string): boolean {
  return (
    /\(\d+,\d+\):\s+(error|warning)/i.test(text) ||
    /:\d+:\d+:\s*(error|warning)/i.test(text) ||
    /\berror TS\d{3,5}\b/i.test(text)
  );
}

function summarizeToolResult(
  candidate: DiscoveredCheckCandidate,
  status: string,
  output: unknown,
): string {
  if (status === "timed_out") {
    return `Timed out while running ${candidate.label}.`;
  }
  if (status === "cancelled") {
    return `Cancelled while running ${candidate.label}.`;
  }
  if (status === "rejected") {
    return `Tool Runtime rejected ${candidate.label}.`;
  }
  const exitCode = extractExitCode(output);
  if (typeof exitCode === "number") {
    return exitCode === 0
      ? `${candidate.label} passed (exit 0).`
      : `${candidate.label} failed (exit ${exitCode}).`;
  }
  if (status === "succeeded") {
    return `${candidate.label} completed.`;
  }
  return `${candidate.label} ended with status ${status}.`;
}
