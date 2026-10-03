import { describe, expect, it } from "vitest";

import {
  isProviderInfrastructureFailure,
  providerInfrastructureUserMessage,
} from "./resolveProviderInfrastructure";

describe("resolveProviderInfrastructure (Phase 5)", () => {
  it("classifies provider_unavailable and rate_limited as infrastructure", () => {
    expect(
      isProviderInfrastructureFailure({ errorCode: "provider_unavailable" }),
    ).toBe(true);
    expect(
      isProviderInfrastructureFailure({ errorCode: "rate_limited" }),
    ).toBe(true);
  });

  it("classifies fetch failed messages as infrastructure", () => {
    expect(
      isProviderInfrastructureFailure({
        errorCode: "execution_failed",
        errorMessage: "fetch failed",
      }),
    ).toBe(true);
    expect(
      isProviderInfrastructureFailure({
        errorMessage: "TypeError: fetch failed",
      }),
    ).toBe(true);
  });

  it("does not classify ordinary agent failures as infrastructure", () => {
    expect(
      isProviderInfrastructureFailure({
        errorCode: "no_mutation_performed",
        errorMessage: "Required mutation was not performed.",
      }),
    ).toBe(false);
  });

  it("builds explicit infrastructure UX copy", () => {
    const message = providerInfrastructureUserMessage({
      errorMessage: "fetch failed",
    });
    expect(message).toMatch(/infrastructure/i);
    expect(message).toMatch(/Continue/i);
    expect(message).not.toMatch(/agent failed/i);
  });
});
