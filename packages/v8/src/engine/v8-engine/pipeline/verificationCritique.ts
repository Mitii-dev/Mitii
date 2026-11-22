import type { ModelRequest } from "../../../modules/model-gateway";
import { packDiagnosticsForModel } from "../../../modules/verification";
import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";

import {
  formatVerificationCritiqueWarnings,
  parseVerificationCritique,
  type VerificationCritiqueResult,
} from "../actions/parseVerificationCritique";
import type { EventBus } from "../internal/EventBus";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";
import type { AgentEngineRuntime } from "./runtime";

/**
 * Optional LLM critique after the evidence gate.
 * Advisory only: never flips accept/reject. Default callers pass
 * `enabled: false`.
 */
export async function tryCritiqueVerification(
  runtime: AgentEngineRuntime,
  params: {
    enabled: boolean;
    bus: EventBus;
    runId: string;
    gateAction: "accept" | "reject";
    verification?: VerificationResult;
    comparison?: RepoBuildStateComparison;
    changedFiles: readonly string[];
    warnings: string[];
    signal: AbortSignal;
    logVerbosity: AgentLogVerbosity;
  },
): Promise<VerificationCritiqueResult | undefined> {
  if (!params.enabled || params.signal.aborted || !params.verification) {
    return undefined;
  }

  try {
    const request: ModelRequest = {
      messages: [
        {
          role: "system",
          content: [
            "You are a read-only verification critic.",
            "Review the evidence pack below. Do not invent diagnostics that are not listed.",
            "Do not call tools. Respond with this exact shape:",
            "",
            "## Verification Result",
            "**Decision:** APPROVE or REJECT",
            "**Issues Found:** (list each issue as `1. [critical|warning|info] …`, or None)",
            "**Reasoning:** brief explanation",
            "",
            "Your Decision is advisory only and cannot override the evidence gate.",
          ].join("\n"),
        },
        {
          role: "user",
          content: buildVerificationCritiqueEvidencePack({
            gateAction: params.gateAction,
            verification: params.verification,
            comparison: params.comparison,
            changedFiles: params.changedFiles,
          }),
        },
      ],
    };

    let text = "";
    let sawToolCall = false;
    for await (const event of runtime.deps.llm.complete(request, {
      abortSignal: params.signal,
    })) {
      if (event.type === "content_delta" && event.content) {
        text += event.content;
      }
      if (event.type === "tool_call_delta") {
        sawToolCall = true;
      }
      if (event.type === "failed" || event.type === "cancelled") {
        if (logVerbosityAtLeast(params.logVerbosity, "verbose")) {
          runtime.emit(params.bus, {
            type: "warning",
            runId: params.runId,
            message: `LLM verification critique skipped (llm_${event.type}).`,
            code: "verification_critique_failed",
            data: { skippedReason: `llm_${event.type}` },
            at: runtime.isoNow(),
          });
        }
        return undefined;
      }
    }

    if (sawToolCall || text.trim().length < 12) {
      if (logVerbosityAtLeast(params.logVerbosity, "verbose")) {
        runtime.emit(params.bus, {
          type: "warning",
          runId: params.runId,
          message: "LLM verification critique skipped (rejected_quality_gate).",
          code: "verification_critique_failed",
          data: { skippedReason: "rejected_quality_gate" },
          at: runtime.isoNow(),
        });
      }
      return undefined;
    }

    const critique = parseVerificationCritique(text);
    if (!critique) {
      return undefined;
    }

    for (const warning of formatVerificationCritiqueWarnings(
      critique,
      params.gateAction,
    )) {
      params.warnings.push(warning);
    }

    runtime.emit(params.bus, {
      type: "verification_critique_ready",
      runId: params.runId,
      decision: critique.decision,
      issueCount: critique.issues.length,
      criticalIssueCount: critique.issues.filter(
        (issue) => issue.severity === "critical",
      ).length,
      gateAction: params.gateAction,
      at: runtime.isoNow(),
    });

    return critique;
  } catch (error) {
    if (logVerbosityAtLeast(params.logVerbosity, "verbose")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message: `LLM verification critique failed: ${describeCaughtError(error)}`,
        code: "verification_critique_failed",
        data: { skippedReason: "llm_error" },
        at: runtime.isoNow(),
      });
    }
    return undefined;
  }
}

function buildVerificationCritiqueEvidencePack(params: {
  gateAction: "accept" | "reject";
  verification: VerificationResult;
  comparison?: RepoBuildStateComparison;
  changedFiles: readonly string[];
}): string {
  const packed = packDiagnosticsForModel({
    diagnostics: params.verification.diagnostics,
    maxTotal: 8,
    maxPerFile: 3,
    errorsOnly: true,
  });
  const checks = params.verification.checks
    .slice(0, 12)
    .map(
      (check) =>
        `- ${check.checkId} [${check.kind}] ${check.outcome}: ${check.summary.slice(0, 160)}`,
    )
    .join("\n");
  const diagnostics = packed.diagnostics
    .map((diagnostic) => {
      const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
      return `- ${diagnostic.path}${line} ${diagnostic.message.slice(0, 200)}`;
    })
    .join("\n");

  return [
    `Evidence gate action: ${params.gateAction}`,
    `Verification status: ${params.verification.status}`,
    `Changed files (${params.changedFiles.length}): ${params.changedFiles.slice(0, 20).join(", ") || "(none)"}`,
    params.comparison
      ? `Delta: new=${params.comparison.newErrorCount} remaining=${params.comparison.remainingErrorCount} cleared=${params.comparison.clearedErrorCount}`
      : "Delta: (none)",
    "",
    "Checks:",
    checks || "(none)",
    "",
    "Error diagnostics:",
    diagnostics || "(none)",
  ].join("\n");
}
