/**
 * Marketplace-lite catalog entries for MCP servers and skills.
 * Install still writes to `.mitii/mcp.json` / `.mitii/skills/` — this is discovery UX only.
 */

export interface MarketplaceCatalogEntry {
  id: string;
  kind: "mcp" | "skill";
  title: string;
  description: string;
  /** Install hint shown in UI / CLI. */
  installHint: string;
  recommended?: boolean;
}

export const MARKETPLACE_LITE_CATALOG: readonly MarketplaceCatalogEntry[] = [
  {
    id: "filesystem",
    kind: "mcp",
    title: "Filesystem MCP",
    description: "Bounded filesystem tools via MCP (opt-in).",
    installHint: "Enable from Mitii Settings → MCP store, or add to .mitii/mcp.json",
    recommended: false,
  },
  {
    id: "sequential-thinking",
    kind: "mcp",
    title: "Sequential Thinking",
    description: "Structured multi-step reasoning helper.",
    installHint: "Enable from Mitii Settings → MCP store",
  },
  {
    id: "memory",
    kind: "mcp",
    title: "Memory MCP",
    description: "External memory tools via MCP.",
    installHint: "Enable from Mitii Settings → MCP store",
  },
  {
    id: "puppeteer",
    kind: "mcp",
    title: "Puppeteer (browser)",
    description: "Optional browser automation via MCP — not a first-party broker.",
    installHint: "Enable from Mitii Settings → MCP store (requires Puppeteer deps)",
  },
  {
    id: "debugging-and-error-recovery",
    kind: "skill",
    title: "Debugging and Error Recovery",
    description: "Systematic triage: reproduce → localize → fix → guard.",
    installHint:
      "Bundled by default. Force with --skill debugging-and-error-recovery or copy under .mitii/skills/",
    recommended: true,
  },
  {
    id: "git-commit-message",
    kind: "skill",
    title: "Git commit message",
    description: "Compact conventional commit from status/diff/log.",
    installHint:
      "Bundled. Auto-attached by Mitii: Generate Commit Message and `mitii commit-message`.",
    recommended: true,
  },
  {
    id: "git-pr-summary",
    kind: "skill",
    title: "Git PR summary",
    description: "Compact PR Summary + Test plan from branch diff.",
    installHint:
      "Bundled. Auto-attached by Mitii: Generate PR Summary and `mitii pr-summary`.",
    recommended: true,
  },
  {
    id: "release-changelog",
    kind: "skill",
    title: "Release changelog",
    description: "Keep a Changelog entry from commits since last tag.",
    installHint:
      "Bundled. Auto-attached by Mitii: Generate Changelog and `mitii changelog`.",
    recommended: true,
  },
] as const;

export function listMarketplaceLite(kind?: "mcp" | "skill"): MarketplaceCatalogEntry[] {
  return MARKETPLACE_LITE_CATALOG.filter((entry) =>
    kind ? entry.kind === kind : true,
  );
}
