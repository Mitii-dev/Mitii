import {
  scopeVerdictSchema,
  type ScopeReadHint,
  type ScopeVerdict,
} from "../../contracts/orient/ScopeVerdict";
import {
  extractExplicitMutationFence,
  hasExplicitEditLimit,
} from "../../../modules/decision-policy/helpers/ExtractExplicitMutationFence";

export interface BuildScopeVerdictInput {
  message: string;
  focusPaths: readonly string[];
  workRoot?: string;
  safetyFencePaths?: readonly string[];
}

function inferReadHint(focusPaths: readonly string[]): ScopeReadHint {
  if (focusPaths.length === 0) return "workspace";
  const first = focusPaths[0] ?? "";
  if (first.includes("/") && !/\.[\w.+-]+$/.test(first)) {
    // Multi-segment folder without extension → package/folder hint.
    return first.split("/").length >= 2 ? "package" : "folder";
  }
  if (focusPaths.length === 1) return "folder";
  return "workspace";
}

/**
 * Build ScopeVerdict: mentions → focus; fence only on explicit limit / safety.
 */
export function buildScopeVerdict(input: BuildScopeVerdictInput): ScopeVerdict {
  const focusPaths = [...new Set(input.focusPaths.filter((p) => p.length > 0))];
  const safety = (input.safetyFencePaths ?? []).filter((p) => p.length > 0);

  if (safety.length > 0) {
    return scopeVerdictSchema.parse({
      focusPaths,
      workRoot: input.workRoot,
      readHint: inferReadHint(focusPaths),
      mutationFence: [...new Set(safety)].sort((a, b) => a.localeCompare(b)),
      evidence: "safety_rule",
      relatedSeeds: [],
    });
  }

  if (hasExplicitEditLimit(input.message)) {
    const fence = extractExplicitMutationFence(input.message, focusPaths);
    return scopeVerdictSchema.parse({
      focusPaths,
      workRoot: input.workRoot,
      readHint: inferReadHint(focusPaths),
      ...(fence ? { mutationFence: fence } : {}),
      evidence: fence ? "explicit_limit" : "unclear",
      relatedSeeds: [],
    });
  }

  return scopeVerdictSchema.parse({
    focusPaths,
    workRoot: input.workRoot,
    readHint: inferReadHint(focusPaths),
    // mutationFence omitted — folder mention ≠ edit prison
    evidence: "focus_only",
    relatedSeeds: [],
  });
}
