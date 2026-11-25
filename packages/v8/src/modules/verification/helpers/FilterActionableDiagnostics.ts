import type { VerificationDiagnostic } from "../contracts";
import {
  isDeniedDiagnosticPath,
  isHarnessFrameDiagnostic,
  isPhantomSecondaryDiagnostic,
  isSyntheticDiagnosticPath,
  normalizeVerificationPath,
} from "../patterns";

export interface FilterActionableDiagnosticsResult {
  actionable: VerificationDiagnostic[];
  omitted: VerificationDiagnostic[];
}

/**
 * Drop harness / denied-tree / optional phantom-secondary diagnostics so
 * compare, repair, and completion gates see only ask-actionable defects.
 *
 * Language-agnostic: path policies live in `patterns.ts`, not per-toolchain
 * special cases in this action.
 */
export function filterActionableDiagnostics(params: {
  diagnostics: readonly VerificationDiagnostic[];
  /**
   * When true (project-local typecheck/build passed), also drop secondary
   * parser phantoms that contradict that authoritative evidence.
   */
  dropPhantomSecondary?: boolean;
  /** Keep synthetic `<test>` rows (assertion bodies without a path). Default false for compare. */
  keepSyntheticTestPaths?: boolean;
}): FilterActionableDiagnosticsResult {
  const actionable: VerificationDiagnostic[] = [];
  const omitted: VerificationDiagnostic[] = [];

  for (const diagnostic of params.diagnostics) {
    if (shouldOmitDiagnostic(diagnostic, params)) {
      omitted.push(diagnostic);
      continue;
    }
    actionable.push(diagnostic);
  }

  return { actionable, omitted };
}

function shouldOmitDiagnostic(
  diagnostic: VerificationDiagnostic,
  params: {
    dropPhantomSecondary?: boolean;
    keepSyntheticTestPaths?: boolean;
  },
): boolean {
  const path = normalizeVerificationPath(diagnostic.path);

  if (isSyntheticDiagnosticPath(path)) {
    return params.keepSyntheticTestPaths !== true;
  }

  if (
    isHarnessFrameDiagnostic({
      path,
      message: diagnostic.message,
    })
  ) {
    return true;
  }

  if (isDeniedDiagnosticPath(path)) {
    return true;
  }

  if (
    params.dropPhantomSecondary === true &&
    isPhantomSecondaryDiagnostic({
      code: diagnostic.code,
      message: diagnostic.message,
    })
  ) {
    return true;
  }

  return false;
}
