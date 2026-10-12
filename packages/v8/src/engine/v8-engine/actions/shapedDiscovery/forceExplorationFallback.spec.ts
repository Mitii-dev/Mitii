import { describe, expect, it } from "vitest";

import {
  buildForceExplorationSearchQueries,
  collectForceExplorationFallbackHits,
} from "./forceExplorationFallback";

describe("buildForceExplorationSearchQueries", () => {
  it("extracts content tokens from a vague improve-tests ask", () => {
    const queries = buildForceExplorationSearchQueries(
      "How I can improve the test cases? Can you plan or changing the architecture?",
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => /\btest\b|\bcases\b/i.test(q))).toBe(true);
  });

  it("returns empty for stopword-only queries", () => {
    expect(buildForceExplorationSearchQueries("can you plan this")).toEqual([]);
  });
});

describe("collectForceExplorationFallbackHits", () => {
  it("runs search_files for derived queries", async () => {
    const calls: string[] = [];
    const hits = await collectForceExplorationFallbackHits({
      query: "Harden oracle grading for backend cases",
      shouldContinue: () => true,
      executeTool: async (toolName, args) => {
        calls.push(toolName);
        if (toolName === "search_files") {
          return {
            matches: [{ path: "src/oracle.ts" }],
          };
        }
        return { paths: [] };
      },
    });
    expect(calls.every((name) => name === "search_files")).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
  });
});
