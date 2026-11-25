export interface GitIgnoreRule {
  source: string;
  negated: boolean;
  directoryOnly: boolean;
  regexp: RegExp;
}

export function parseGitIgnoreContents(contents: string): GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const rule = parseGitIgnoreLine(rawLine);
    if (rule) {
      rules.push(rule);
    }
  }

  return rules;
}

export function parseGitIgnoreLine(line: string): GitIgnoreRule | undefined {
  let pattern = line.replace(/\\ /g, " ");
  if (!pattern.endsWith("\\ ")) {
    pattern = pattern.trimEnd();
  }

  const trimmedStart = pattern.trimStart();
  if (!trimmedStart || trimmedStart.startsWith("#")) {
    return undefined;
  }

  pattern = trimmedStart;

  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  if (!pattern) {
    return undefined;
  }

  let directoryOnly = false;
  if (pattern.endsWith("/") && pattern !== "/") {
    directoryOnly = true;
    pattern = pattern.slice(0, -1);
  }

  const anchored = pattern.startsWith("/");
  if (anchored) {
    pattern = pattern.slice(1);
  }

  if (!pattern || pattern === ".") {
    return undefined;
  }

  const matchInAnyDirectory = !anchored && !pattern.includes("/");

  return {
    source: line.trim(),
    negated,
    directoryOnly,
    regexp: gitIgnoreGlobToRegExp(pattern, matchInAnyDirectory),
  };
}

export function gitIgnoreRuleMatches(
  rule: GitIgnoreRule,
  relativePath: string,
  kind: "file" | "directory" | "symbolic_link" | "other",
): boolean {
  if (rule.directoryOnly && kind === "file") {
    return false;
  }

  return rule.regexp.test(relativePath);
}

export function applyGitIgnoreRules(
  rules: readonly GitIgnoreRule[],
  relativePath: string,
  kind: "file" | "directory" | "symbolic_link" | "other",
): GitIgnoreRule | undefined {
  let matched: GitIgnoreRule | undefined;

  for (const rule of rules) {
    if (gitIgnoreRuleMatches(rule, relativePath, kind)) {
      matched = rule;
    }
  }

  return matched;
}

export function gitIgnoreGlobToRegExp(
  pattern: string,
  matchInAnyDirectory: boolean,
): RegExp {
  let source = matchInAnyDirectory ? "(?:^|.*/)" : "^";
  let index = 0;

  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }

    if (
      pattern.startsWith("**", index) &&
      index + 2 === pattern.length
    ) {
      source += ".*";
      index += 2;
      continue;
    }

    const current = pattern[index];
    if (current === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (current === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    source += escapeRegex(current ?? "");
    index += 1;
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
