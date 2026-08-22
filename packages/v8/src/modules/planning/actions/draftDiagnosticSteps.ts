import type { PlanStep, PlanningBuildEvidence } from "../contracts";
import { PLANNING_WORKING_SET_POLICY } from "../policy";
import { chunkList, clipPhrase, step } from "./draftPlanShared";

export function buildDiagnosticChangeSteps(
  buildEvidence: PlanningBuildEvidence | undefined,
  risk: PlanStep["riskLevel"],
  maxFilesPerBatch?: number,
): PlanStep[] {
  const diagnostics = (buildEvidence?.diagnostics ?? []).filter(
    (diag) => diag.severity === "error",
  );
  if (diagnostics.length === 0) {
    return [];
  }

  const batchSize =
    maxFilesPerBatch ?? PLANNING_WORKING_SET_POLICY.maxWritePerBatch;
  const steps: PlanStep[] = [];

  for (const group of groupDiagnosticsByCode(diagnostics)) {
    const pathChunks = chunkList(group.paths, batchSize);
    for (const [chunkIndex, chunkPaths] of pathChunks.entries()) {
      const chunkPathSet = new Set(chunkPaths);
      const chunkDiagnostics = group.diagnostics.filter((item) =>
        chunkPathSet.has(item.path.trim()),
      );
      const primary = chunkDiagnostics[0] ?? group.diagnostics[0]!;
      const codeLabel = group.code || "diagnostic";
      const fileNote =
        chunkPaths.length === 1
          ? chunkPaths[0]!
          : `${chunkPaths[0]!} +${chunkPaths.length - 1} files`;
      const batchNote =
        pathChunks.length > 1
          ? ` (${chunkIndex + 1}/${pathChunks.length})`
          : "";
      const countNote =
        chunkDiagnostics.length === 1
          ? `the reported ${codeLabel} diagnostic`
          : `${chunkDiagnostics.length} ${codeLabel} diagnostics`;
      const batchScope =
        pathChunks.length > 1
          ? `in this batch of ${chunkPaths.length} (same root cause; remaining files of this class stay on later steps)`
          : "in a single batch (same root cause)";
      steps.push(
        step(
          `step-fix-diagnostic-${steps.length + 1}`,
          clipPhrase(`Fix ${codeLabel} in ${fileNote}${batchNote}`, 200),
          chunkPaths,
          clipPhrase(
            `Address ${countNote} ${batchScope}. ${primary.message}`,
            1_000,
          ),
          `${codeLabel} diagnostics are resolved or reduced without introducing new errors.`,
          risk,
          buildEvidence?.failedChecks?.join(", "),
        ),
      );
    }
  }

  return steps.slice(0, PLANNING_WORKING_SET_POLICY.maxBatchesOnPlan);
}

export function mergeDiagnosticChangeSteps(
  diagnosticSteps: readonly PlanStep[],
  retained: readonly PlanStep[],
): PlanStep[] {
  const diagnostics = diagnosticSteps.slice(
    0,
    PLANNING_WORKING_SET_POLICY.maxBatchesOnPlan,
  );
  const remaining = Math.max(0, 20 - diagnostics.length);
  return [...diagnostics, ...retained.slice(0, remaining)];
}

export function groupDiagnosticsByCode(
  diagnostics: readonly NonNullable<
    PlanningBuildEvidence["diagnostics"]
  >[number][],
): Array<{
  code: string;
  paths: string[];
  diagnostics: NonNullable<PlanningBuildEvidence["diagnostics"]>;
}> {
  const byCode = new Map<
    string,
    NonNullable<PlanningBuildEvidence["diagnostics"]>
  >();
  for (const diagnostic of diagnostics) {
    const code = diagnostic.code?.trim() || diagnostic.path.trim() || "unknown";
    const existing = byCode.get(code);
    if (existing) {
      if (existing.length < 24) {
        existing.push(diagnostic);
      }
    } else {
      byCode.set(code, [diagnostic]);
    }
  }
  return [...byCode.entries()]
    .map(([code, grouped]) => ({
      code,
      paths: [
        ...new Set(grouped.map((item) => item.path.trim()).filter(Boolean)),
      ],
      diagnostics: grouped,
    }))
    .sort((left, right) => right.diagnostics.length - left.diagnostics.length);
}
