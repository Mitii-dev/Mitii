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
import { mergeChangeImpactResults } from "./mergeChangeImpactResults";

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
      "Multi-seed change impact input failed schema validation.",
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
