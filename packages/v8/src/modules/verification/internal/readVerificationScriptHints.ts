import type { VerificationManifestReaderPort } from "../contracts";

const HINT_MANIFESTS = [
  "AGENTS.md",
  "agents.md",
  ".mitii/verification.md",
  "CONTRIBUTING.md",
] as const;

/** Max distinct hint tokens kept from workspace instruction files. */
const MAX_HINTS = 32;

/**
 * Soft script/token hints from trusted instruction files.
 * Used only to reorder already-discovered checks — never to invent argv.
 */
export async function readVerificationScriptHints(
  manifests: VerificationManifestReaderPort,
): Promise<string[]> {
  const hints = new Set<string>();
  for (const path of HINT_MANIFESTS) {
    if (hints.size >= MAX_HINTS) {
      break;
    }
    const text = await manifests.readText(path);
    if (!text) {
      continue;
    }
    for (const hint of extractScriptHints(text)) {
      hints.add(hint);
      if (hints.size >= MAX_HINTS) {
        break;
      }
    }
  }
  return [...hints];
}

export function extractScriptHints(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const packageManagerRun =
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z][\w:-]*)/g;
  for (const match of text.matchAll(packageManagerRun)) {
    pushHint(seen, found, match[1]!);
  }

  const backtickScripts =
    /`((?:test|lint|typecheck|build|check|format|verify)[\w:-]*)`/gi;
  for (const match of text.matchAll(backtickScripts)) {
    pushHint(seen, found, match[1]!);
  }

  const verifyColon = /\b(verify:[\w:-]+)\b/g;
  for (const match of text.matchAll(verifyColon)) {
    pushHint(seen, found, match[1]!);
  }

  return found;
}

function pushHint(
  seen: Set<string>,
  found: string[],
  raw: string,
): void {
  const hint = raw.trim().toLowerCase();
  if (!hint || seen.has(hint)) {
    return;
  }
  // Ignore bare package managers mistaken as scripts.
  if (hint === "npm" || hint === "pnpm" || hint === "yarn" || hint === "bun") {
    return;
  }
  seen.add(hint);
  found.push(hint);
}
