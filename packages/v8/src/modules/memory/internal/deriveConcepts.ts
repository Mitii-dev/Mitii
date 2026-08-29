import { MEMORY_THRESHOLDS } from "../policy";
import { uniqueTokens } from "./tokenize";

const CONCEPT_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "uses",
  "use",
  "using",
  "always",
  "never",
  "into",
  "when",
  "then",
  "than",
  "have",
  "has",
  "are",
  "was",
  "were",
  "not",
  "but",
  "you",
  "your",
  "our",
  "its",
  "prefer",
  "preference",
  "preferred",
  "prefers",
  "team",
]);

/**
 * Build a concept list for indexing when the host omitted concepts.
 * Tags are trusted; remaining slots are filled from title/content tokens.
 */
export function deriveConcepts(params: {
  tags: readonly string[];
  concepts: readonly string[];
  title?: string;
  content: string;
}): string[] {
  const seen = new Set<string>();
  const concepts: string[] = [];

  const push = (raw: string): void => {
    const value = raw.trim().toLowerCase();
    if (value.length < 2 || CONCEPT_STOP_WORDS.has(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    concepts.push(value);
  };

  for (const concept of params.concepts) {
    push(concept);
  }
  for (const tag of params.tags) {
    push(tag);
  }

  if (concepts.length >= MEMORY_THRESHOLDS.maxDerivedConcepts) {
    return concepts.slice(0, MEMORY_THRESHOLDS.maxDerivedConcepts);
  }

  const remainder = uniqueTokens(
    [params.title ?? "", params.content].filter(Boolean).join(" "),
  );
  for (const token of remainder) {
    if (concepts.length >= MEMORY_THRESHOLDS.maxDerivedConcepts) {
      break;
    }
    push(token);
  }

  return concepts;
}
