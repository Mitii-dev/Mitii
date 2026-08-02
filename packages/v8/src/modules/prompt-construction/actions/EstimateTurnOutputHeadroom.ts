import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";
import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";

export interface TurnOutputHeadroom {
  maximumOutputTokens: number;
  safePayloadCharacters: number;
  withinHeadroom: boolean;
  estimatedPayloadCharacters: number;
}

/**
 * Soft preflight: compare an estimated mutation payload size against a
 * fraction of the provider maximum output. Used by Agent Engine to decide
 * whether to nudge the model toward smaller batches before / after truncation.
 *
 * Character estimates use the same heuristic as CharacterTokenEstimator.
 */
export function estimateTurnOutputHeadroom(params: {
  maximumOutputTokens: number;
  estimatedPayloadCharacters: number;
  headroomRatio?: number;
}): TurnOutputHeadroom {
  const ratio =
    params.headroomRatio ??
    PROMPT_CONSTRUCTION_THRESHOLDS.mutationOutputHeadroomRatio;
  const safeTokens = Math.floor(params.maximumOutputTokens * ratio);
  const safePayloadCharacters = Math.max(
    0,
    safeTokens * DEFAULT_CHARACTERS_PER_TOKEN,
  );

  return {
    maximumOutputTokens: params.maximumOutputTokens,
    safePayloadCharacters,
    estimatedPayloadCharacters: params.estimatedPayloadCharacters,
    withinHeadroom:
      params.estimatedPayloadCharacters <= safePayloadCharacters,
  };
}
