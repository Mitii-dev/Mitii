import { describe, expect, it } from "vitest";

import {
  EmbeddingGenerator,
} from "../EmbeddingGenerator";
import type {
  EmbeddingProfile,
  EmbeddingProvider,
  EmbeddingVectorCachePort,
} from "../types";
import type { Chunk } from "../../chunking/types";

const PROFILE: EmbeddingProfile = {
  id: "test:deterministic:4:l2",
  providerId: "deterministic-test",
  modelId: "test-model",
  dimensions: 4,
  normalized: true,
};

class CountingProvider implements EmbeddingProvider {
  public readonly profile = PROFILE;
  public calls = 0;

  public async embed(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    this.calls += 1;
    return texts.map((text) => [text.length || 1, 2, 3, 4]);
  }
}

class MemoryVectorCache implements EmbeddingVectorCachePort {
  public readonly store = new Map<string, readonly number[]>();

  public get(profileId: string, contentHash: string): readonly number[] | undefined {
    return this.store.get(`${profileId}:${contentHash}`);
  }

  public set(
    profileId: string,
    contentHash: string,
    vector: readonly number[],
  ): void {
    this.store.set(`${profileId}:${contentHash}`, vector);
  }
}

function createChunk(id: string, content: string): Chunk {
  return {
    id,
    sourceId: "source",
    rootId: "root",
    relativePath: `src/${id}.ts`,
    strategyId: "code",
    ordinal: 0,
    kind: "code_symbol",
    content,
    sourceContentHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    tokenEstimate: 8,
    startOffset: 0,
    endOffset: content.length,
    startLine: 1,
    endLine: 1,
    title: id,
  };
}

describe("embedding vector cache", () => {
  it("skips the provider when the same chunk hash and profile are cached", async () => {
    const provider = new CountingProvider();
    const cache = new MemoryVectorCache();
    const generator = new EmbeddingGenerator(provider, {
      vectorCache: cache,
    });
    const chunks = [createChunk("login", "export const login = true;")];

    const first = await generator.generate({ chunks });
    const second = await generator.generate({ chunks });

    expect(first.status).toBe("complete");
    expect(second.status).toBe("complete");
    expect(first.records[0]?.vector).toEqual(second.records[0]?.vector);
    expect(provider.calls).toBe(1);
    expect(second.statistics.providerCalls).toBe(0);
    expect(cache.store.size).toBe(1);
  });
});
