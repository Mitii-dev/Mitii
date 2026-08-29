import { stem } from "./stemmer";

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["auth", "authentication", "authn", "authenticating"],
  ["authz", "authorization", "authorizing"],
  ["db", "database", "datastore"],
  ["config", "configuration", "configuring", "setup"],
  ["deps", "dependencies", "dependency"],
  ["env", "environment"],
  ["fn", "function"],
  ["impl", "implementation", "implementing"],
  ["repo", "repository"],
  ["req", "request"],
  ["res", "response"],
  ["ts", "typescript"],
  ["js", "javascript"],
  ["err", "error", "errors"],
  ["api", "endpoint", "endpoints"],
  ["test", "testing", "tests", "vitest", "jest"],
  ["doc", "documentation", "docs"],
  ["deploy", "deployment", "deploying"],
  ["cache", "caching", "cached"],
  ["log", "logging", "logs"],
  ["sec", "security", "secure"],
  ["validate", "validation", "validating"],
  ["migrate", "migration", "migrations"],
  ["debug", "debugging"],
  ["middleware", "mw"],
  ["button", "btn"],
  ["login", "signin", "sign-in", "log-in"],
];

const synonymMap = new Map<string, Set<string>>();

for (const group of SYNONYM_GROUPS) {
  const stemmed = group.map((term) => stem(term.toLowerCase()));
  for (const term of stemmed) {
    const bucket = synonymMap.get(term) ?? new Set<string>();
    for (const other of stemmed) {
      if (other !== term) {
        bucket.add(other);
      }
    }
    synonymMap.set(term, bucket);
  }
}

export function getSynonyms(stemmedTerm: string): string[] {
  const matches = synonymMap.get(stemmedTerm);
  return matches ? [...matches] : [];
}
