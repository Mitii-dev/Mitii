import { stem } from "./stemmer";

const MIN_TOKEN_LENGTH = 2;

/**
 * Split text into stemmed retrieve tokens. Path separators stay so
 * `src/LoginForm.tsx` remains searchable as a unit; callers should also
 * index path segments separately.
 */
const QUERY_STOP_WORDS = new Set(
  [
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "of",
    "to",
    "for",
    "with",
    "when",
    "that",
    "this",
    "it",
    "is",
    "are",
    "was",
    "be",
    "by",
    "from",
    "as",
    "at",
    "user",
    "show",
    "until",
    "into",
    "than",
    "then",
    "also",
    "just",
    "not",
    "do",
    "does",
    "did",
    "can",
    "will",
    "would",
    "should",
    "keep",
    "add",
    "i",
    "am",
    "if",
    "there",
    "already",
    "nearby",
    "prefer",
    "preference",
    "preferred",
    "prefers",
    "like",
    "always",
    "never",
    "use",
    "using",
    "used",
    "about",
    "please",
    "want",
    "need",
    "needed",
    "make",
    "made",
    "get",
    "got",
    "team",
  ].map((word) => stem(word)),
);

export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s/.\\-_]/gu, " ");
  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (raw.length < MIN_TOKEN_LENGTH) {
      continue;
    }
    tokens.push(stem(raw));
  }
  return tokens;
}

export function tokenizeQuery(text: string): string[] {
  return tokenize(text).filter((token) => !QUERY_STOP_WORDS.has(token));
}

export function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}
