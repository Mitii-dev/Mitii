import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_PROTECTED_PATH_GLOBS,
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

/**
 * Merge default protected path globs into rules when enabled and globs empty.
 * Does not enable rules by itself.
 */
export function withDefaultProtectedPaths(
  rules: UserSafetyRules,
): UserSafetyRules {
  if (!rules.enabled) {
    return rules;
  }
  if (rules.protectedPathGlobs.length > 0) {
    return rules;
  }
  return {
    ...rules,
    protectedPathGlobs: [...DEFAULT_PROTECTED_PATH_GLOBS],
  };
}

/** Example content for scaffolding `.mitii/safety.json`. */
export const USER_SAFETY_RULES_EXAMPLE = `{
  "enabled": false,
  "denyTools": ["delete_directory"],
  "denyCommandPrefixes": ["rm", "sudo", "git push"],
  "allowCommandPrefixes": ["pnpm", "npm", "git status", "git diff"],
  "denyPathScopes": [],
  "denyNetworkHosts": [],
  "protectedPathGlobs": ${JSON.stringify([...DEFAULT_PROTECTED_PATH_GLOBS], null, 2).split("\n").join("\n  ")},
  "autoApprove": {
    "write": false,
    "execute": false,
    "mcp": false,
    "network": false,
    "external": false
  },
  "approvalCeiling": "when_required"
}
`;
