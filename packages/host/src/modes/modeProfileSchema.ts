import { z } from "zod";

/**
 * Mode profile schema — overlays on Mitii AgentMode (ask|plan|agent).
 * Compiles to projectRules + tighten-only UserSafetyRules. Never widens grants.
 */
export const MODE_PROFILE_SCHEMA_VERSION = 1 as const;

export const MODE_TOOL_GROUPS = [
  "read",
  "edit",
  "command",
  "mcp",
  "network",
] as const;

export const modeToolGroupSchema = z.enum(MODE_TOOL_GROUPS);
export type ModeToolGroup = z.infer<typeof modeToolGroupSchema>;

export const modeProfileSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9-]+$/, "Slug must be alphanumeric with dashes"),
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    whenToUse: z.string().max(2_000).optional(),
    /** Mitii interaction mode this profile runs as. */
    agentMode: z.enum(["ask", "plan", "agent"]),
    roleDefinition: z.string().min(1).max(8_000),
    customInstructions: z.string().max(12_000).optional(),
    /**
     * Tool groups retained after intersect. Omitted = no tool deny from groups
     * (Decision Policy grant stands). When set, tools outside the union are denied.
     */
    toolGroups: z.array(modeToolGroupSchema).min(1).optional(),
    /**
     * Mutation relative paths must match this regex (e.g. Architect `\\.md$`).
     */
    mutationRelativePathRegex: z.string().min(1).max(200).optional(),
    source: z.enum(["builtin", "project"]).optional(),
  })
  .strict();

export type ModeProfile = z.infer<typeof modeProfileSchema>;

export const modeCatalogSchema = z
  .object({
    schemaVersion: z.literal(MODE_PROFILE_SCHEMA_VERSION),
    /** Active overlay slug; omit to leave AgentMode unmodified by catalog. */
    active: z.string().min(1).max(64).optional(),
    modes: z.array(modeProfileSchema).max(32).default([]),
  })
  .strict();

export type ModeCatalog = z.infer<typeof modeCatalogSchema>;
