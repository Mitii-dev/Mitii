/**
 * Evidence sufficiency valve after happy-path bind budget is exhausted.
 * Never: budget exhausted → open-world search burst → patch whatever.
 * Always: local named miss → capped recovery → gate again → clarify/escalate.
 */

const FILE_LIKE =
  /\.[A-Za-z0-9]{1,12}$/;

/**
 * Missing evidence is identifiable and local when every path looks like a
 * concrete file (not a bare package/folder root).
 */
export function isIdentifiableLocalEvidence(
  missingPaths: readonly string[],
): boolean {
  if (missingPaths.length === 0) {
    return false;
  }
  return missingPaths.every((path) => {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    const base = normalized.split("/").pop() ?? "";
    return FILE_LIKE.test(base);
  });
}

export type EvidenceRecoveryDecision =
  | { kind: "recovery"; paths: string[] }
  | { kind: "clarify"; rationale: string };

/**
 * After gate nudges are spent: one recovery envelope if miss is local,
 * otherwise clarify/escalate (no unbounded explore).
 */
export function decideEvidenceRecovery(params: {
  missingPaths: readonly string[];
  recoveryAlreadyUsed: boolean;
  maxRecoveryPaths: number;
}): EvidenceRecoveryDecision {
  if (params.recoveryAlreadyUsed) {
    return {
      kind: "clarify",
      rationale:
        "Evidence recovery budget exhausted without enough_to_patch. Name the concrete file or stop — do not broaden search.",
    };
  }
  if (!isIdentifiableLocalEvidence(params.missingPaths)) {
    return {
      kind: "clarify",
      rationale:
        "Bind budget exhausted without identifiable local file evidence. Clarify the change surface (file path) before more reads or patches.",
    };
  }
  const paths = params.missingPaths.slice(
    0,
    Math.max(1, params.maxRecoveryPaths),
  );
  return { kind: "recovery", paths };
}

export function buildEvidenceRecoveryMessage(params: {
  paths: readonly string[];
  recoveryTurns: number;
}): string {
  const list = params.paths.map((path) => `- ${path}`).join("\n");
  return [
    "Evidence recovery (bounded — not open search).",
    "enough_to_patch: false",
    "RequiredEvidenceBeforePatch:",
    list,
    `At most ${Math.max(1, params.recoveryTurns)} more read turn(s) on those paths only.`,
    "Call read_file / read_many_files for those paths, then apply_patch.",
    "Do not list_directory, glob_files, or broad search. Do not edit node_modules or build outputs.",
    "Workspace edits are NOT done until apply_patch lands.",
  ].join("\n");
}

export function buildEvidenceClarifyMessage(rationale: string): string {
  return [
    rationale,
    "Do not keep rediscovering. Prefer Continue with an explicit file path, or stop here.",
  ].join("\n");
}
