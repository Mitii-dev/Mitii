/**
 * Minimal workspace-safe glob matcher.
 * Supports `*`, `?`, and `**` across path segments. No brace expansion or
 * character classes — keep patterns simple and auditable.
 */
export function matchGlob(relativePath: string, pattern: string): boolean {
  const path = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const pat = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (pat.length === 0) {
    return false;
  }
  return globToRegExp(pat).test(path);
}

export function assertSafeGlobPattern(pattern: string): void {
  const normalized = pattern.replace(/\\/g, "/");
  if (normalized.includes("\0")) {
    throw new Error("Glob pattern contains null bytes.");
  }
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes("..")
  ) {
    throw new Error(
      `Glob pattern must be relative and must not contain "..": "${pattern}".`,
    );
  }
}

function globToRegExp(pattern: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    const char = pattern[i]!;
    if (char === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
        continue;
      }
      out += ".*";
      i += 2;
      continue;
    }
    if (char === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if ("+.^$()[]{}|\\".includes(char)) {
      out += `\\${char}`;
      i += 1;
      continue;
    }
    out += char;
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}
