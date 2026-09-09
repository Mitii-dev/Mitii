import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DISABLED_USER_SAFETY_RULES,
  userSafetyRulesSchema,
  type UserSafetyRules,
} from "@mitii/v8";

export const USER_SAFETY_RULES_FILENAME = "safety.json";

/**
 * Load tighten-only user safety rules from `<workspace>/.mitii/safety.json`.
 * Missing / disabled / invalid files return DISABLED_USER_SAFETY_RULES.
 */
export function loadUserSafetyRules(
  workspaceRoot: string,
): UserSafetyRules {
  const path = join(workspaceRoot, ".mitii", USER_SAFETY_RULES_FILENAME);
  if (!existsSync(path)) {
    return { ...DISABLED_USER_SAFETY_RULES };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = userSafetyRulesSchema.safeParse(raw);
    if (!parsed.success) {
      return { ...DISABLED_USER_SAFETY_RULES };
    }
    return parsed.data;
  } catch {
    return { ...DISABLED_USER_SAFETY_RULES };
  }
}

/** Example content for scaffolding `.mitii/safety.json`. */
export const USER_SAFETY_RULES_EXAMPLE = `{
  "enabled": false,
  "denyTools": ["delete_directory"],
  "denyCommandPrefixes": ["rm", "sudo", "git push"],
  "allowCommandPrefixes": ["pnpm", "npm", "git status", "git diff"],
  "denyPathScopes": [],
  "denyNetworkHosts": [],
  "approvalCeiling": "when_required"
}
`;
