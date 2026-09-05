import { describe, expect, it } from "vitest";

import {
  resolvePromptCacheClass,
  shouldPreserveModelLoopPrefix,
} from "../resolvePromptCacheClass";

describe("resolvePromptCacheClass", () => {
  it("returns no_cache when the adapter does not support caching", () => {
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: false,
        modelCalls: 0,
      }),
    ).toBe("no_cache");
  });

  it("stays prompt_cache early when support is advertised", () => {
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: true,
        modelCalls: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      }),
    ).toBe("prompt_cache");
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: true,
        modelCalls: 1,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      }),
    ).toBe("prompt_cache");
  });

  it("falls back to no_cache when local providers never report hit/miss", () => {
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: true,
        modelCalls: 2,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      }),
    ).toBe("no_cache");
  });

  it("keeps prompt_cache when hits are observed", () => {
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: true,
        modelCalls: 5,
        cacheHitTokens: 12_000,
        cacheMissTokens: 0,
      }),
    ).toBe("prompt_cache");
  });

  it("keeps prompt_cache when only miss/write tokens are reported", () => {
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: true,
        modelCalls: 3,
        cacheHitTokens: 0,
        cacheMissTokens: 8_000,
      }),
    ).toBe("prompt_cache");
  });

  it("maps cache class to preservePrefix", () => {
    expect(shouldPreserveModelLoopPrefix("prompt_cache")).toBe(true);
    expect(shouldPreserveModelLoopPrefix("no_cache")).toBe(false);
  });

  it("treats missing supportsPromptCaching as no_cache", () => {
    expect(
      resolvePromptCacheClass({
        modelCalls: 0,
      }),
    ).toBe("no_cache");
  });

  it("keeps prompt_cache when both hit and miss tokens are present", () => {
    expect(
      resolvePromptCacheClass({
        supportsPromptCaching: true,
        modelCalls: 4,
        cacheHitTokens: 1_000,
        cacheMissTokens: 2_000,
      }),
    ).toBe("prompt_cache");
  });
});
