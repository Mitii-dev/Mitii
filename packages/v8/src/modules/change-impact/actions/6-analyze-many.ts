import { CHANGE_IMPACT_MESSAGES } from "../constants";
import {
  ChangeImpactError,
  changeImpactMultiInputSchema,
} from "../contracts";
import type {
  ChangeImpactMergedResult,
  ChangeImpactParsedMultiInput,
  ChangeImpactResult,
} from "../contracts";
import { ChangeImpactPipeline } from "../pipeline/ChangeImpactPipeline";
import { mergeChangeImpactResults } from "./7-merge-results";

/**
 * Analyze multiple seeds independently and merge conservatively.
 */
export function analyzeManyChangeImpact(params: {
  input: ChangeImpactParsedMultiInput | unknown;
  pipeline?: ChangeImpactPipeline;
}): {
  merged: ChangeImpactMergedResult;
  results: ChangeImpactResult[];
} {
  let parsed: ChangeImpactParsedMultiInput;
  try {
    parsed = changeImpactMultiInputSchema.parse(params.input);
  } catch (error) {
    throw new ChangeImpactError(
      "invalid_input",
      CHANGE_IMPACT_MESSAGES.multiInputInvalid,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const pipeline = params.pipeline ?? new ChangeImpactPipeline();
  const { seeds, ...shared } = parsed;
  const results = seeds.map((seed) =>
    pipeline.analyze({
      ...shared,
      seed,
    }),
  );

  const merged = mergeChangeImpactResults({ results });
  return { merged, results };
}
