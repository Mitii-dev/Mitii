import {
  REPO_BUILD_STATE_SCHEMA_VERSION,
  repoBuildStateSchema,
  type RepoBuildState,
  type VerificationInput,
  type VerificationResult,
} from "../contracts";

export function captureRepoBuildState(params: {
  phase: "before" | "after";
  input: VerificationInput;
  result: VerificationResult;
  capturedAt?: string;
}): RepoBuildState {
  const diagnostics = (params.result.allDiagnostics ?? params.result.diagnostics)
    .slice(0, 500);
  const checks = params.result.checks.slice(0, 32);
  const projectIds =
    params.result.affectedProjectIds.length > 0
      ? params.result.affectedProjectIds
      : params.input.projects.map((project) => project.projectId);

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
    reasonCodes: params.result.reasonCodes,
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
        if (
          parts.length >= 2 &&
          (parts[0] === "packages" || parts[0] === "apps")
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
