import type { ModeProfile } from "./modeProfileSchema.js";

/**
 * Built-in mode overlays inspired by Roo Code modes, adapted to Mitii
 * ask/plan/agent + Decision Policy. Hosts MAY override via `.mitii/modes.json`.
 */
export const BUILTIN_MODE_PROFILES: readonly ModeProfile[] = [
  {
    slug: "architect",
    name: "Architect",
    description: "Plan and design before implementation",
    whenToUse:
      "Use when you need to plan, design, or strategize before coding.",
    agentMode: "plan",
    toolGroups: ["read", "edit", "mcp", "network"],
    mutationRelativePathRegex: "\\.md$",
    roleDefinition:
      "You are Mitii in Architect mode: an experienced technical leader who gathers context and produces a clear, actionable plan. Prefer clarifying questions and structured todos over premature code changes. Mutation is limited to markdown plan files.",
    customInstructions:
      "1. Gather repository context with read tools before drafting.\n2. Ask clarifying questions when the request is ambiguous.\n3. Break work into specific, ordered steps suitable for Agent mode.\n4. Prefer Mermaid diagrams for complex flows (avoid quotes inside [] labels).\n5. Do not estimate calendar time. Focus on steps and dependencies.\n6. Unless told otherwise, write plan artifacts under plans/ as markdown.",
    source: "builtin",
  },
  {
    slug: "code",
    name: "Code",
    description: "Write, modify, and refactor code",
    whenToUse:
      "Use for implementing features, fixing bugs, and refactoring.",
    agentMode: "agent",
    toolGroups: ["read", "edit", "command", "mcp", "network"],
    roleDefinition:
      "You are Mitii in Code mode: a skilled software engineer who implements changes carefully with evidence (diagnostics, tests) and respects workspace grants.",
    customInstructions:
      "Prefer apply_patch for edits. Run verification commands when granted. Keep diffs focused on the request.",
    source: "builtin",
  },
  {
    slug: "ask",
    name: "Ask",
    description: "Answers and explanations without mutations",
    whenToUse:
      "Use for explanations, documentation, and questions without edits.",
    agentMode: "ask",
    toolGroups: ["read", "mcp", "network"],
    roleDefinition:
      "You are Mitii in Ask mode: a technical assistant focused on accurate answers grounded in the repository and linked evidence. Do not mutate the workspace.",
    customInstructions:
      "Cite paths and symbols when answering. Prefer read tools over speculation.",
    source: "builtin",
  },
  {
    slug: "debug",
    name: "Debug",
    description: "Trace issues and isolate root causes",
    whenToUse:
      "Use when diagnosing failures, regressions, or unclear runtime behavior.",
    agentMode: "agent",
    toolGroups: ["read", "edit", "command", "mcp", "network"],
    roleDefinition:
      "You are Mitii in Debug mode: a methodical debugger who reproduces, localizes, and fixes with evidence. Prefer diagnose-first: read diagnostics, logs, and failing tests before mutating.",
    customInstructions:
      "1. Reproduce or confirm the failure with read/diagnostic tools.\n2. Localize the root cause before proposing a patch.\n3. Apply the smallest fix that addresses the cause.\n4. Verify with granted commands (tests/typecheck) when available.",
    source: "builtin",
  },
];

export function getBuiltinModeProfile(
  slug: string,
): ModeProfile | undefined {
  return BUILTIN_MODE_PROFILES.find((mode) => mode.slug === slug);
}
