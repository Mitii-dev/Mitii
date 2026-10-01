import { FRAGMENT_POLICY } from "./fragmentPolicy";
import type { ContextualFragment, FragmentRole } from "./ContextualFragment";

export interface SkillCatalogL1Entry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * Optional L1 skill awareness strip (OpenCode SkillGuidance pattern).
 * Name + description only — never full SKILL.md bodies. Default off for 30k.
 */
export class SkillCatalogFragment implements ContextualFragment {
  public readonly id = "system:skill-catalog-l1";

  constructor(private readonly entries: readonly SkillCatalogL1Entry[]) {}

  role(): FragmentRole {
    return "system";
  }

  contentKind(): string {
    return "generic.skill_catalog_l1";
  }

  requiresSeparateMessage(): boolean {
    return false;
  }

  markers(): readonly [string, string] {
    return ["", ""] as const;
  }

  body(): string {
    return formatSkillCatalogL1(this.entries);
  }

  maxTokens(): number {
    return FRAGMENT_POLICY.skillCatalogL1MaxTokens;
  }

  section(): "skills" {
    return "skills";
  }

  trust(): "trusted_instruction" {
    return "trusted_instruction";
  }
}

export function formatSkillCatalogL1(
  entries: readonly SkillCatalogL1Entry[],
): string {
  const capped = entries
    .filter((entry) => entry.id.trim() && entry.name.trim())
    .slice(0, FRAGMENT_POLICY.skillCatalogL1MaxEntries);
  if (capped.length === 0) {
    return [
      "Skills provide specialized instructions for specific tasks.",
      "No skills are currently listed in the catalog strip.",
    ].join("\n");
  }
  return [
    "Skills provide specialized instructions for specific tasks.",
    "Selected skill bodies (if any) appear under Skills headings below; this list is awareness only.",
    "<available_skills>",
    ...capped.flatMap((entry) => [
      "  <skill>",
      `    <name>${escapeXml(entry.name)}</name>`,
      `    <description>${escapeXml(entry.description || entry.name)}</description>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
