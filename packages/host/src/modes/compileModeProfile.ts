import {
  GITHUB_MUTATION_TOOL_IDS,
  MUTATION_TOOL_IDS,
  NETWORK_TOOL_IDS,
  OPT_IN_MUTATION_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
  type UserSafetyRules,
} from "@mitii/v8";

import type { ModeProfile, ModeToolGroup } from "./modeProfileSchema.js";

const EDIT_TOOL_IDS = [
  ...MUTATION_TOOL_IDS,
  ...GITHUB_MUTATION_TOOL_IDS,
] as const;

const COMMAND_TOOL_IDS = [
  ...OPT_IN_MUTATION_TOOL_IDS,
  "run_readonly_command",
] as const;

/** Every known built-in tool id used for group → deny intersect. */
export const MODE_CATALOG_TOOL_IDS: readonly string[] = [
  ...READ_ONLY_TOOL_IDS,
  ...EDIT_TOOL_IDS,
  ...COMMAND_TOOL_IDS,
  ...NETWORK_TOOL_IDS,
];

export interface CompiledModeProfile {
  slug: string;
  name: string;
  agentMode: "ask" | "plan" | "agent";
  /** Prompt Construction projectRules blocks (role + instructions). */
  projectRules: Array<{
    id: string;
    title: string;
    content: string;
    priority: number;
  }>;
  /**
   * Tighten-only safety fragment. Merge with workspace safety.json via
   * mergeUserSafetyRules — never apply alone without enabled:true.
   */
  userSafetyRules: UserSafetyRules;
}

/**
 * Compile a mode profile into Mitii start-input fragments.
 * Decision Policy still owns the base grant; this only intersects.
 */
export function compileModeProfile(
  profile: ModeProfile,
): CompiledModeProfile {
  const projectRules: CompiledModeProfile["projectRules"] = [
    {
      id: `mode-role:${profile.slug}`,
      title: `Mode: ${profile.name}`,
      content: profile.roleDefinition,
      priority: 280,
    },
  ];
  if (profile.customInstructions?.trim()) {
    projectRules.push({
      id: `mode-instructions:${profile.slug}`,
      title: `${profile.name} instructions`,
      content: profile.customInstructions.trim(),
      priority: 270,
    });
  }
  if (profile.whenToUse?.trim()) {
    projectRules.push({
      id: `mode-when:${profile.slug}`,
      title: `${profile.name} when to use`,
      content: profile.whenToUse.trim(),
      priority: 260,
    });
  }

  const denyTools = profile.toolGroups
    ? resolveDeniedTools(profile.toolGroups)
    : [];

  const userSafetyRules: UserSafetyRules = {
    enabled: denyTools.length > 0 || Boolean(profile.mutationRelativePathRegex),
    denyTools,
    denyCommandPrefixes: [],
    denyPathScopes: [],
    denyNetworkHosts: [],
    protectedPathGlobs: [],
    ...(profile.mutationRelativePathRegex
      ? { mutationRelativePathRegex: profile.mutationRelativePathRegex }
      : {}),
  };

  return {
    slug: profile.slug,
    name: profile.name,
    agentMode: profile.agentMode,
    projectRules,
    userSafetyRules,
  };
}

function resolveDeniedTools(groups: readonly ModeToolGroup[]): string[] {
  const allowed = new Set<string>();
  for (const group of groups) {
    for (const toolId of toolsForGroup(group)) {
      allowed.add(toolId);
    }
  }
  // MCP tools are dynamic (mcp__*); when mcp group is present we do not deny
  // them by id. When absent, Intersect cannot strip unknown mcp__ ids at
  // compile time — host should omit mcp attach instead. Built-in catalog only.
  return MODE_CATALOG_TOOL_IDS.filter((toolId) => !allowed.has(toolId));
}

function toolsForGroup(group: ModeToolGroup): readonly string[] {
  switch (group) {
    case "read":
      return READ_ONLY_TOOL_IDS;
    case "edit":
      return EDIT_TOOL_IDS;
    case "command":
      return COMMAND_TOOL_IDS;
    case "network":
      return NETWORK_TOOL_IDS;
    case "mcp":
      // No static tool ids — MCP tools are attached at runtime.
      return [];
    default: {
      const _exhaustive: never = group;
      return _exhaustive;
    }
  }
}
