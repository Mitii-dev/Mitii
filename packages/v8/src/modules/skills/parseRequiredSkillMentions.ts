import { MAX_REQUIRED_SKILLS } from "./constants";

const SKILL_MENTION_PATTERN =
  /@skill:([a-z0-9][a-z0-9_.-]{0,63})/gi;
const SLASH_SKILL_LINE_PATTERN =
  /^\/([a-z0-9][a-z0-9_.-]{0,63})\b\s*(?:$|\r)/im;

export function normalizeSkillId(value: string): string | undefined {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || undefined;
}

export function parseRequiredSkillMentions(message: string): {
  cleanedMessage: string;
  requiredSkillIds: string[];
} {
  const ids: string[] = [];
  const seen = new Set<string>();

  const addId = (raw: string | undefined) => {
    const id = raw ? normalizeSkillId(raw) : undefined;
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  };

  message.replace(SKILL_MENTION_PATTERN, (_match, raw: string) => {
    addId(raw);
    return " ";
  });

  const slashMatch = SLASH_SKILL_LINE_PATTERN.exec(message);
  if (slashMatch) {
    addId(slashMatch[1]);
  }

  const cleanedMessage = message
    .replace(SKILL_MENTION_PATTERN, " ")
    .replace(SLASH_SKILL_LINE_PATTERN, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    cleanedMessage,
    requiredSkillIds: ids.slice(0, MAX_REQUIRED_SKILLS),
  };
}

export function mergeRequiredSkillIds(
  explicit: readonly string[] | undefined,
  fromMessage: readonly string[],
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...(explicit ?? []), ...fromMessage]) {
    const id = normalizeSkillId(raw);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(id);
    if (merged.length >= MAX_REQUIRED_SKILLS) {
      break;
    }
  }

  return merged;
}
