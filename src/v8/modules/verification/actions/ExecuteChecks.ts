import type { ToolGrant } from "../../decision-policy";
import type { RepositoryStateReference } from "../../repository-state";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import type {
  VerificationCheckOutcome,
  VerificationCheckResult,
  VerificationToolExecutorPort,
} from "../contracts";
import { MISSING_TOOL_PATTERNS } from "../policy";
import type { DiscoveredCheckCandidate } from "../internal/discovery";

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
  signal?: AbortSignal;
}): Promise<ExecuteChecksResult> {
  const checks: VerificationCheckResult[] = [];
  const toolOutputs = new Map<string, unknown>();
  const warnings: string[] = [];
  let cancelled = false;

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
    const outcome = mapToolResultToOutcome(result.status, result.output);
    const summary = summarizeToolResult(candidate, result.status, result.output);

    if (
      outcome === "failed" &&
      MISSING_TOOL_PATTERNS.test(extractOutputText(result.output))
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
