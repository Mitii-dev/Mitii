/**
 * Diff / blast-radius rail (S10-BLAST) — escalate to existing approval kinds.
 * Not a new suspend kind.
 */

export type BlastRadiusEscalate =
  | "mutation_approval"
  | "destructive_action";

export interface AssessBlastRadiusInput {
  /** Paths touched this batch / proposed patch. */
  changedPaths: readonly string[];
  /** Plan-approved write paths (or mutation fence). Outside → escalate. */
  allowedWritePaths?: readonly string[];
  /** Soft file-count ceiling before escalate (default 24). */
  maxFiles?: number;
  /** When true, treat oversize as destructive escalate. */
  destructiveIfOversize?: boolean;
}

export interface AssessBlastRadiusOk {
  ok: true;
  reasonCodes: string[];
}

export interface AssessBlastRadiusEscalate {
  ok: false;
  escalate: BlastRadiusEscalate;
  /** Soft nudge text for rails / report — never a new gate kind. */
  message: string;
  reasonCodes: string[];
  /** Structured flags for GateContext / consult callers. */
  needsMutationApproval: boolean;
  needsDestructiveApproval: boolean;
}

export type AssessBlastRadiusResult =
  | AssessBlastRadiusOk
  | AssessBlastRadiusEscalate;

function pathAllowed(
  path: string,
  allowed: readonly string[],
): boolean {
  if (allowed.length === 0) return true;
  return allowed.some(
    (root) => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`),
  );
}

export function assessBlastRadius(
  input: AssessBlastRadiusInput,
): AssessBlastRadiusResult {
  const maxFiles = input.maxFiles ?? 24;
  const changed = [...new Set(input.changedPaths.map((p) => p.trim()).filter(Boolean))];
  const reasonCodes: string[] = [];

  if (changed.length === 0) {
    return { ok: true, reasonCodes: ["blast_radius_empty"] };
  }

  const allowed = input.allowedWritePaths ?? [];
  const outside = changed.filter((p) => !pathAllowed(p, allowed));
  if (allowed.length > 0 && outside.length > 0) {
    reasonCodes.push("blast_radius_outside_plan");
    return {
      ok: false,
      escalate: "mutation_approval",
      message: `Edits outside plan write paths: ${outside.slice(0, 6).join(", ")}`,
      reasonCodes,
      needsMutationApproval: true,
      needsDestructiveApproval: false,
    };
  }

  if (changed.length > maxFiles) {
    reasonCodes.push("blast_radius_oversize");
    const destructive = input.destructiveIfOversize === true;
    return {
      ok: false,
      escalate: destructive ? "destructive_action" : "mutation_approval",
      message: `Large diff: ${changed.length} files (max ${maxFiles})`,
      reasonCodes,
      needsMutationApproval: !destructive,
      needsDestructiveApproval: destructive,
    };
  }

  return { ok: true, reasonCodes: ["blast_radius_ok"] };
}
