/**
 * Build verification repair user prompt (+ optional diagnostic source lines).
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";
import {
  buildVerificationRepairPrompt,
  loadDiagnosticSourceLines,
} from "../actions";
import type { prepareRepairWorkingSet } from "../internal/taskListRuntime";

export async function loadRepairSourceLines(params: {
  workspaceRoot: string | undefined;
  verification: VerificationResult | undefined;
}): Promise<ReadonlyMap<string, string> | undefined> {
  if (!params.workspaceRoot || !params.verification) {
    return undefined;
  }
  try {
    const lines = await loadDiagnosticSourceLines({
      workspaceRoot: params.workspaceRoot,
      diagnostics: params.verification.diagnostics,
    });
    return lines.size > 0 ? lines : undefined;
  } catch {
    return undefined;
  }
}

export async function buildVerificationRepairUserContent(params: {
  verification: VerificationResult | undefined;
  comparison: RepoBuildStateComparison | undefined;
  changedFiles: string[];
  decision: ExecutionDecision;
  workspaceRoot: string | undefined;
  askScopePaths: readonly string[];
  userPrompt: string;
  activeBatch: ReturnType<typeof prepareRepairWorkingSet>["activeItem"];
}): Promise<string> {
  return buildVerificationRepairPrompt({
    verification: params.verification,
    comparison: params.comparison,
    changedFiles: params.changedFiles,
    mutationBudget: params.decision.toolGrant.mutationBudget,
    sourceLines: await loadRepairSourceLines({
      workspaceRoot: params.workspaceRoot,
      verification: params.verification,
    }),
    askScopePaths: [...params.askScopePaths],
    userPrompt: params.userPrompt,
    ...(params.activeBatch
      ? {
          activeBatch: {
            title: params.activeBatch.title,
            write: params.activeBatch.write,
            mustRead: params.activeBatch.mustRead,
            affected: params.activeBatch.affected,
          },
        }
      : {}),
  });
}
