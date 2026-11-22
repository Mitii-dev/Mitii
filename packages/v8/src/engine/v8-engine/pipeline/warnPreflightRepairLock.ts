import { EXECUTION_ROUTE } from "../../../modules/decision-policy";
import type { RepoBuildState } from "../../../modules/verification";
import { shouldForcePreflightRepairLock } from "../modules/user-path-priority";

/**
 * The thin loop never arms repair-lock steering; this records a warning when
 * preflight diagnostics and the user request diverge or overlap.
 */
export function warnPreflightRepairLock(params: {
  route: string;
  maximumWorkspaceEffect: string;
  repoBuildStateBefore: RepoBuildState | undefined;
  changedFilesCount: number;
  userPrompt: string;
  warnings: string[];
}): void {
  const { repoBuildStateBefore, warnings } = params;
  const preflightErrorCount = repoBuildStateBefore?.summary.errorCount ?? 0;
  const wouldLock = shouldForcePreflightRepairLock({
    route: params.route,
    maximumWorkspaceEffect: params.maximumWorkspaceEffect,
    preflightErrorCount,
    changedFilesCount: params.changedFilesCount,
    userPrompt: params.userPrompt,
    diagnosticPaths: (repoBuildStateBefore?.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.path),
  });
  if (
    preflightErrorCount > 0 &&
    params.route === EXECUTION_ROUTE.EXECUTE &&
    !wouldLock
  ) {
    warnings.push(
      "User-cited paths diverge from preflight diagnostics; repair lock not applied.",
    );
  } else if (wouldLock) {
    warnings.push(
      "Preflight errors overlap the user request; thin loop still runs without mutation lock.",
    );
  }
}
