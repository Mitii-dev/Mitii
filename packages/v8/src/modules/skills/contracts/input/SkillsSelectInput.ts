import { z } from "zod";

import { executionRouteSchema } from "../../../decision-policy";
import { agentModeSchema } from "../../../request-intake";

import { SKILLS_SCHEMA_VERSION } from "../../constants";
import { MAX_REQUIRED_SKILLS } from "../../constants";
import {
  DEFAULT_MAX_SKILLS,
  DEFAULT_SKILLS_BUDGET_TOKENS,
} from "../../defaults";

/**
 * Slim task evidence for skill selection.
 * Engine maps Request Understanding into this slice so Skills never owns
 * classification internals.
 */
export const skillTaskEvidenceSchema = z
  .object({
    primaryIntent: z.string().min(1),
    secondaryIntents: z.array(z.string().min(1)).default([]),
    scope: z.string().min(1).optional(),
    complexity: z.string().min(1).optional(),
    risk: z.string().min(1).optional(),
    recommendsPlanning: z.boolean().optional(),
    recommendsVerification: z.boolean().optional(),
    /**
     * Repository paths already discovered by the host/context layer. Used only
     * to gate path-scoped skills; Skills never scans the workspace.
     */
    paths: z.array(z.string().min(1)).max(50).default([]),
    /**
     * Soft tags from Request Understanding. Boost only — never sole authority.
     */
    recommendedSkillTags: z
      .array(z.string().min(1).max(64))
      .max(10)
      .default([]),
    /**
     * Soft repository evidence passed through from Repository State/hosts.
     * Skills core treats these as tag-like boosts only.
     */
    languages: z.array(z.string().min(1).max(64)).max(20).default([]),
    projectKinds: z.array(z.string().min(1).max(64)).max(20).default([]),
  })
  .strict();

export type SkillTaskEvidence = z.infer<typeof skillTaskEvidenceSchema>;

export const skillsSelectInputSchema = z
  .object({
    schemaVersion: z.literal(SKILLS_SCHEMA_VERSION),
    query: z.string().min(1),
    mode: agentModeSchema,
    route: executionRouteSchema,
    evidence: skillTaskEvidenceSchema,
    budgetTokens: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_SKILLS_BUDGET_TOKENS),
    maxSkills: z.number().int().positive().default(DEFAULT_MAX_SKILLS),
    /**
     * Explicitly attached skill ids (from @skill:, CLI --skill, or host pin).
     * Bypass relevance matching but not policy/tool grants.
     */
    requiredSkillIds: z
      .array(z.string().min(1).max(64))
      .max(MAX_REQUIRED_SKILLS)
      .default([]),
    /**
     * When true, omit sizeClass L skills unless alwaysApply / required.
     * Engine sets this for compact no_cache windows.
     */
    forbidLargeSkills: z.boolean().optional(),
  })
  .strict();

export type SkillsSelectInput = z.input<typeof skillsSelectInputSchema>;
export type SkillsSelectParsedInput = z.infer<typeof skillsSelectInputSchema>;
