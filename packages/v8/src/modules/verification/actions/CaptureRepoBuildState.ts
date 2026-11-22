import {
  REPO_BUILD_STATE_SCHEMA_VERSION,
  repoBuildStateSchema,
  type RepoBuildState,
  type VerificationInput,
  type VerificationResult,
} from "../contracts";
import { projectLocalCompilePassed } from "./AssessTaskRelevantEvidence";
import { filterActionableDiagnostics } from "./FilterActionableDiagnostics";

export function captureRepoBuildState(params: {
  phase: "before" | "after";
  input: VerificationInput;
  result: VerificationResult;
  capturedAt?: string;
}): RepoBuildState {
  const raw = (params.result.allDiagnostics ?? params.result.diagnostics).slice(
    0,
    500,
  );
  const { actionable, omitted } = filterActionableDiagnostics({
    diagnostics: raw,
    dropPhantomSecondary: projectLocalCompilePassed(params.result.checks),
    keepSyntheticTestPaths: false,
  });
  const diagnostics = actionable.slice(0, 500);
  const checks = params.result.checks.slice(0, 32);
  const projectIds =
    params.result.affectedProjectIds.length > 0
      ? params.result.affectedProjectIds
      : params.input.projects.map((project) => project.projectId);

  const reasonCodes = [...params.result.reasonCodes];
  if (omitted.length > 0 && !reasonCodes.includes("residual_harness_noise")) {
    // Surface that snapshot counts exclude non-actionable residuals.
    reasonCodes.push("residual_harness_noise");
  }

  return repoBuildStateSchema.parse({
    schemaVersion: REPO_BUILD_STATE_SCHEMA_VERSION,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    phase: params.phase,
    scope: {
      workspaceRoot: params.input.workspaceRoot,
      folderPrefixes: deriveFolderPrefixes(params.input.changedFiles),
      projectIds: uniqueStrings(projectIds),
      changeScope: params.input.changeScope ?? "localized",
    },
    checks,
    diagnostics,
    summary: {
      errorCount: diagnostics.filter((diag) => diag.severity === "error")
        .length,
      warningCount: diagnostics.filter((diag) => diag.severity === "warning")
        .length,
      failedCheckIds: checks
        .filter(
          (check) =>
            check.outcome === "failed" ||
            check.outcome === "timed_out" ||
            check.outcome === "cancelled",
        )
        .map((check) => check.checkId),
    },
    reasonCodes: [...new Set(reasonCodes)],
  });
}

function deriveFolderPrefixes(paths: readonly string[]): string[] {
  return uniqueStrings(
    paths
      .map((path) => path.trim().replace(/\\/g, "/").replace(/^@+/, ""))
      .filter(
        (path) =>
          path.length > 0 && !path.startsWith("/") && !path.includes(".."),
      )
      .map((path) => {
        const parts = path.split("/").filter(Boolean);
        // Prefer two-segment package roots when present (apps/x, packages/x,
        // crates/x, libs/x) — otherwise keep the parent directory.
        if (
          parts.length >= 2 &&
          (parts[0] === "packages" ||
            parts[0] === "apps" ||
            parts[0] === "crates" ||
            parts[0] === "libs" ||
            parts[0] === "services")
        ) {
          return `${parts[0]}/${parts[1]}`;
        }
        if (parts.length <= 1) {
          return ".";
        }
        return parts.slice(0, -1).join("/");
      }),
  ).slice(0, 32);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
