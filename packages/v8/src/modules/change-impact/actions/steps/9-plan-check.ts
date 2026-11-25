import {
  CHANGE_IMPACT_MESSAGES,
  CHANGE_IMPACT_REASON,
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../../constants";
import {
  ChangeImpactError,
  changeImpactPlanCheckInputSchema,
  changeImpactPlanCheckResultSchema,
} from "../../types";
import type {
  ChangeImpactParsedPlanCheckInput,
  ChangeImpactPlanCheckResult,
} from "../../types";
import { normalizeRelativePath } from "../../helpers/impactGraphHelpers";
import { ChangeImpactPipeline } from "../ChangeImpactPipeline";
import { analyzeManyChangeImpact } from "./6-analyze-many";
import {
  evaluateSpillover,
  spilloverTokensFromResult,
} from "./8-evaluate-spillover";
import { recommendWidenVerification } from "./12-recommend-widen";

/**
 * Counterfactual blast-radius check for a proposed path set.
 * Does not mutate the working tree — only walks the published graph.
 */
export function planCheckChangeImpact(params: {
  input: ChangeImpactParsedPlanCheckInput | unknown;
  pipeline?: ChangeImpactPipeline;
}): ChangeImpactPlanCheckResult {
  let parsed: ChangeImpactParsedPlanCheckInput;
  try {
    parsed = changeImpactPlanCheckInputSchema.parse(params.input);
  } catch (error) {
    throw new ChangeImpactError(
      "invalid_input",
      CHANGE_IMPACT_MESSAGES.planCheckInputInvalid,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const proposedPaths = uniquePaths(parsed.proposedPaths);
  const { expectedPackages: expectedPackagesInput, proposedPaths: _paths, ...shared } =
    parsed;
  const { merged } = analyzeManyChangeImpact({
    pipeline: params.pipeline,
    input: {
      ...shared,
      seeds: proposedPaths.map((relativePath) => ({
        kind: "file" as const,
        relativePath,
      })),
    },
  });

  const reasonCodes = new Set(merged.reasonCodes);
  reasonCodes.add(CHANGE_IMPACT_REASON.planCheckComplete);
  const warnings = [
    ...merged.warnings,
    {
      code: "plan_check_complete" as const,
      message: `Plan-check analyzed ${proposedPaths.length} proposed path(s).`,
    },
  ];

  let spillover: ChangeImpactPlanCheckResult["spillover"];
  if (expectedPackagesInput && expectedPackagesInput.length > 0) {
    const tokens = spilloverTokensFromResult(merged);
    spillover = evaluateSpillover({
      expectedPackages: expectedPackagesInput,
      ...tokens,
    });
    for (const code of spillover.reasonCodes) reasonCodes.add(code);
    warnings.push(...spillover.warnings);
  }

  return changeImpactPlanCheckResultSchema.parse({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    proposedPaths,
    merged,
    ...(spillover ? { spillover } : {}),
    widenVerification:
      recommendWidenVerification(merged) ||
      Boolean(spillover && !spillover.withinExpected),
    reasonCodes: [...reasonCodes],
    warnings,
  });
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const normalized = normalizeRelativePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
