import { describe, expect, it } from "vitest";

import {
  INTENT_CLASSIFIER_MAXIMUM_OUTPUT_TOKENS_BY_BAND,
  resolveIntentClassifierMaximumOutputTokens,
} from "../intent/resolveIntentClassifierMaximumOutputTokens";

describe("resolveIntentClassifierMaximumOutputTokens", () => {
  it("scales by compact / standard / wide bands", () => {
    expect(resolveIntentClassifierMaximumOutputTokens(32_000)).toBe(
      INTENT_CLASSIFIER_MAXIMUM_OUTPUT_TOKENS_BY_BAND.compact,
    );
    expect(resolveIntentClassifierMaximumOutputTokens(64_000)).toBe(
      INTENT_CLASSIFIER_MAXIMUM_OUTPUT_TOKENS_BY_BAND.standard,
    );
    expect(resolveIntentClassifierMaximumOutputTokens(128_000)).toBe(
      INTENT_CLASSIFIER_MAXIMUM_OUTPUT_TOKENS_BY_BAND.wide,
    );
  });

  it("clamps to a positive provider maximum when lower", () => {
    expect(resolveIntentClassifierMaximumOutputTokens(64_000, 1_500)).toBe(
      1_500,
    );
  });

  it("does not re-raise a provider maximum below the 512 floor", () => {
    expect(resolveIntentClassifierMaximumOutputTokens(64_000, 256)).toBe(256);
  });
});
