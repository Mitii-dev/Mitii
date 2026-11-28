/**
 * Inline enrich retrieval — deterministic stubs for tests / hosts without modules.
 */

import type {
  RuntimeMemoryRetrievalPort,
  RuntimeRepoContextRetrievalPort,
  RuntimeSkillsRetrievalPort,
} from "../../ports/RuntimeEnrichRetrievalPorts";

export function createInlineSkillsRetrieval(
  overrides?: Partial<Record<string, string>>,
): RuntimeSkillsRetrievalPort {
  return {
    async retrieve(input) {
      const max = input.maxItems ?? 16;
      const items = input.skillIds
        .slice(0, max)
        .map((id) => overrides?.[id] ?? `skill:${id}`);
      return {
        items,
        reasonCodes: items.length > 0 ? ["inline_skills_retrieved"] : [],
      };
    },
  };
}

export function createInlineMemoryRetrieval(
  facts: readonly string[] = [],
): RuntimeMemoryRetrievalPort {
  return {
    async retrieve(input) {
      const max = input.maxItems ?? 24;
      const matched =
        facts.length > 0
          ? [...facts]
          : input.query.trim()
            ? [`memory:${input.query.trim().slice(0, 120)}`]
            : [];
      return {
        facts: matched.slice(0, max),
        reasonCodes:
          matched.length > 0 ? ["inline_memory_retrieved"] : ["inline_memory_empty"],
      };
    },
  };
}

export function createInlineRepoRetrieval(): RuntimeRepoContextRetrievalPort {
  return {
    async retrieve(input) {
      const max = input.maxItems ?? 24;
      const slices = [...input.focusPaths].slice(0, max);
      return {
        slices,
        reasonCodes:
          slices.length > 0 ? ["inline_repo_retrieved"] : ["inline_repo_empty"],
      };
    },
  };
}
