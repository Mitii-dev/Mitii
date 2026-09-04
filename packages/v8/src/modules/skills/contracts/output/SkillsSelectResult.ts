import { z } from "zod";

import {
  SKILL_OMISSION_REASONS,
  SKILL_REASON_CODES,
  SKILL_SELECTION_KINDS,
  SKILL_SELECTION_STATUSES,
  SKILLS_SCHEMA_VERSION,
} from "../../constants";

export const skillInstructionBlockSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    content: z.string().min(1),
    priority: z.number().int().nonnegative().default(100),
    resources: z
      .object({
        references: z.array(z.string().min(1)).default([]),
        scripts: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .optional(),
    provenance: z
      .object({
        skillId: z.string().min(1),
        source: z.literal("skills"),
        score: z.number().min(0).max(1),
        selection: z.enum(SKILL_SELECTION_KINDS).optional(),
        conflictGroup: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type SkillInstructionBlock = z.infer<typeof skillInstructionBlockSchema>;

export const skillOmissionSchema = z
  .object({
    skillId: z.string().min(1),
    reason: z.enum(SKILL_OMISSION_REASONS),
    tokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export type SkillOmission = z.infer<typeof skillOmissionSchema>;

export const skillsSelectResultSchema = z
  .object({
    schemaVersion: z.literal(SKILLS_SCHEMA_VERSION),
    status: z.enum(SKILL_SELECTION_STATUSES),
    instructions: z.array(skillInstructionBlockSchema),
    omissions: z.array(skillOmissionSchema),
    required: z.array(z.string().min(1).max(160)).max(20).default([]),
    requiredCount: z.number().int().nonnegative().default(0),
    matchedCount: z.number().int().nonnegative().default(0),
    usedTokens: z.number().int().nonnegative(),
    budgetTokens: z.number().int().positive(),
    warnings: z.array(z.string()),
    reasonCodes: z.array(z.enum(SKILL_REASON_CODES)),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type SkillsSelectResult = z.infer<typeof skillsSelectResultSchema>;
export type SkillReasonCode = (typeof SKILL_REASON_CODES)[number];
