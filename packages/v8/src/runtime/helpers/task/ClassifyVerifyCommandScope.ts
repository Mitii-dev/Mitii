/**
 * Classify verify argv as change-scoped (selective) vs package-wide (broad).
 * Desk seal prefers selective outcomes so full-suite env noise cannot steal Continue.
 */

export type VerifyCommandScope = "selective" | "broad";

export function classifyVerifyCommandScope(
  argv: readonly string[],
): VerifyCommandScope {
  const parts = argv.map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return "broad";

  const head = (parts[0] ?? "").toLowerCase();
  const joined = parts.join(" ").toLowerCase();

  // node --test <paths…> is always change-scoped when any path-like arg exists.
  if (head === "node" || head === "nodejs") {
    if (parts.includes("--test") && hasPathLikeArg(parts.slice(1))) {
      return "selective";
    }
    return "broad";
  }

  // Package-manager test/lint/build with no file operands → broad suite.
  if (
    head === "pnpm" ||
    head === "npm" ||
    head === "yarn" ||
    head === "bun" ||
    head === "npx"
  ) {
    if (hasPathLikeArg(parts)) return "selective";
    if (/\b(?:test|lint|typecheck|build|vitest|tsc)\b/.test(joined)) {
      return "broad";
    }
  }

  if (head === "vitest" || head === "pytest" || head === "tsc") {
    return hasPathLikeArg(parts.slice(1)) ? "selective" : "broad";
  }

  return hasPathLikeArg(parts) ? "selective" : "broad";
}

function hasPathLikeArg(parts: readonly string[]): boolean {
  return parts.some((part) => {
    const value = part.trim();
    if (value.length === 0 || value.startsWith("-")) return false;
    // Package names (@scope/name) are not file operands.
    if (/^@[\w.-]+\/[\w.-]+$/.test(value)) return false;
    // Structural path / file operand — never hard-code a monorepo layout.
    return (
      value.includes("/") ||
      value.includes("\\") ||
      /\.(?:js|cjs|mjs|ts|tsx|jsx|py)$/i.test(value)
    );
  });
}
