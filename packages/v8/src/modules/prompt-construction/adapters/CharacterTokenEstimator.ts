import { DEFAULT_CHARACTERS_PER_TOKEN } from "../defaults";
import type { TokenEstimatorPort } from "../contracts";

/**
 * Local chars/N token estimator used when Engine does not inject a port.
 * Matches the V8 repository-state CharacterTokenEstimator convention.
 */
export class CharacterTokenEstimator implements TokenEstimatorPort {
  constructor(
    private readonly charactersPerToken: number = DEFAULT_CHARACTERS_PER_TOKEN,
  ) {
    if (!Number.isFinite(charactersPerToken) || charactersPerToken <= 0) {
      throw new RangeError(
        "charactersPerToken must be a positive finite number.",
      );
    }
  }

  public estimate(content: string): number {
    if (!content) {
      return 0;
    }
    return Math.max(1, Math.ceil(content.length / this.charactersPerToken));
  }
}
