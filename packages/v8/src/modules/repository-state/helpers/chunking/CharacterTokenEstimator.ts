import {
  CHUNKING_DEFAULTS,
  CHUNKING_IDS,
} from "./constants";

import type {
  ChunkTokenEstimator,
} from "./types";

export class CharacterTokenEstimator
  implements ChunkTokenEstimator
{
  public readonly id =
    CHUNKING_IDS
      .CHARACTER_TOKEN_ESTIMATOR;

  constructor(
    private readonly charactersPerToken =
      CHUNKING_DEFAULTS
        .CHARACTERS_PER_ESTIMATED_TOKEN,
  ) {
    if (
      !Number.isFinite(
        charactersPerToken,
      ) ||
      charactersPerToken <= 0
    ) {
      throw new RangeError(
        "charactersPerToken must be a positive finite number.",
      );
    }
  }

  public estimate(
    content: string,
  ): number {
    if (!content) {
      return 0;
    }

    return Math.max(
      1,
      Math.ceil(
        content.length /
          this.charactersPerToken,
      ),
    );
  }
}

