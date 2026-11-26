import type { VerificationResult } from "../../../modules/verification";
import type { RunEvidence } from "../../../engine/v8-engine/contracts";
import type { ToolResult } from "../../../engine/tool-runtime";
import { clipEvidenceText, RUN_EVIDENCE_LIMITS } from "./ClampRunEvidence";
import { uniqueStrings } from "../plan-discovery/PlanningPathUtils";

export function isSuccessfulVerificationToolResult(
  toolName: string,
  result: ToolResult,
): boolean {
  if (toolName !== "run_readonly_command" || result.status !== "succeeded") {
    return false;
  }
  const output = result.output;
  if (!output || typeof output !== "object") {
    return false;
  }
  const record = output as { argv?: unknown; exitCode?: unknown };
  if (record.exitCode !== 0 || !Array.isArray(record.argv)) {
    return false;
  }
  const argv = record.argv.filter(
    (part): part is string => typeof part === "string",
  );
  if (argv.length === 0) {
    return false;
  }
  const command = argv.join(" ").toLowerCase();
  return /\b(?:build|check|compile|lint|test|typecheck|tsc|vitest|jest|pytest|ctest)\b/.test(
    command,
  );
}

export function diagnosticToIssue(
  diagnostic: VerificationResult["diagnostics"][number],
  params: {
    idPrefix: string;
    index: number;
    status: RunEvidence["issues"][number]["status"];
  },
): RunEvidence["issues"][number] {
  return {
    id: `${params.idPrefix}-${params.index + 1}`,
    source: diagnostic.source ?? "diagnostic",
    path: diagnostic.path,
    message: diagnostic.message,
    ...(diagnostic.code ? { code: diagnostic.code } : {}),
    status: params.status,
    ...(diagnostic.checkId
      ? {
          verificationEvidence: clipEvidenceText(
            `check:${diagnostic.checkId}`,
            RUN_EVIDENCE_LIMITS.verificationEvidence,
          ),
        }
      : {}),
  };
}

export function diagnosticKey(diagnostic: VerificationResult["diagnostics"][number]): string {
  return [
    diagnostic.path,
    diagnostic.startLine ?? "",
    diagnostic.source ?? "",
    diagnostic.code ?? "",
    diagnostic.message,
  ].join("|");
}

export function mergeIssues(
  current: RunEvidence["issues"],
  next: RunEvidence["issues"],
): RunEvidence["issues"] {
  const byKey = new Map<string, RunEvidence["issues"][number]>();
  for (const issue of current) {
    byKey.set(issueKey(issue), issue);
  }
  for (const issue of next) {
    byKey.set(issueKey(issue), issue);
  }
  return [...byKey.values()].slice(0, 500);
}

export function issueKey(issue: RunEvidence["issues"][number]): string {
  return [issue.path ?? "", issue.code ?? "", issue.message].join("|");
}

export function upsertLedgerEntry(
  evidence: RunEvidence,
  entry: RunEvidence["ledger"][number],
): void {
  const index = evidence.ledger.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    evidence.ledger[index] = entry;
  } else {
    evidence.ledger.push(entry);
  }
  trimEvidence(evidence);
}

export function trimEvidence(evidence: RunEvidence): void {
  evidence.ledger = evidence.ledger.slice(-500);
  evidence.issues = evidence.issues.slice(0, 500);
}

export function extractEvidencePaths(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const record = output as {
    changedFiles?: unknown;
    path?: unknown;
    argv?: unknown;
  };
  const paths: string[] = [];
  if (typeof record.path === "string") paths.push(record.path);
  if (Array.isArray(record.changedFiles)) {
    for (const item of record.changedFiles) {
      if (typeof item === "string") paths.push(item);
    }
  }
  return uniqueStrings(paths).slice(0, 40);
}

export function hasCheckpointOutput(output: unknown): boolean {
  return Boolean(
    output &&
      typeof output === "object" &&
      "checkpointId" in output &&
      typeof (output as { checkpointId?: unknown }).checkpointId === "string",
  );
}

export function isVerificationCommandOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const argv = (output as { argv?: unknown }).argv;
  if (!Array.isArray(argv)) return false;
  const command = argv
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return /\b(?:build|check|compile|lint|test|typecheck|tsc|vitest|jest|pytest|ctest)\b/.test(
    command,
  );
}
