import { describe, expect, it } from "vitest";

import { SqliteEmbeddingVectorCache } from "../SqliteEmbeddingVectorCache";

describe("SqliteEmbeddingVectorCache", () => {
  it("falls back to memory when SQLite exec/get/set fails", () => {
    const cache = new SqliteEmbeddingVectorCache({
      exec: () => {
        throw new Error("SQLITE_ERROR: no such table");
      },
      prepare: () => ({
        get: () => {
          throw new Error("SQLITE_ERROR");
        },
        run: () => {
          throw new Error("SQLITE_ERROR");
        },
      }),
    } as never);

    expect(cache.get("profile", "hash")).toBeUndefined();
    expect(() =>
      cache.set("profile", "hash", [0.1, 0.2, 0.3]),
    ).not.toThrow();
    expect(cache.get("profile", "hash")).toEqual([0.1, 0.2, 0.3]);
  });
});
