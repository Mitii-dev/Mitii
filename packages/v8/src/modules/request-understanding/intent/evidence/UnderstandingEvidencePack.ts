import { z } from "zod";

import { INTENT_CONSTANTS } from "../constants";
import { InteractionIntentEnum, taskSizeSchema } from "../schema";

const taskIntentEnum = z.enum(INTENT_CONSTANTS.TASK_INTENTS);

export const rulePriorSchema = z
  .object({
    intent: taskIntentEnum,
    interactionIntent: InteractionIntentEnum.optional(),
    confidence: z.number().min(0).max(1),
    source: z.enum(["heuristic_rule", "explicit_rule"]),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const sizeDraftSchema = z
  .object({
    taskSize: taskSizeSchema,
    reasons: z.array(z.string().min(1).max(120)).max(12),
  })
  .strict();

export const understandingEvidencePackSchema = z
  .object({
    mode: z.enum(["ask", "plan", "agent"]),
    turnKind: z.enum(["new", "continue", "steer", "follow_up", "recover"]),
    origin: z.string().max(64).optional(),

    message: z
      .object({
        text: z.string(),
        originalLength: z.number().int().nonnegative(),
        approxWords: z.number().int().nonnegative(),
        looksLikePasteDump: z.boolean(),
        looksLikeTestFailurePaste: z.boolean(),
      })
      .strict(),

    artifacts: z
      .object({
        files: z
          .array(
            z
              .object({
                path: z.string().min(1).max(500),
                kind: z.string().min(1).max(64),
              })
              .strict(),
          )
          .max(40),
        folders: z
          .array(z.object({ path: z.string().min(1).max(500) }).strict())
          .max(20),
        selections: z
          .array(
            z
              .object({
                path: z.string().min(1).max(500),
                startLine: z.number().int().positive().optional(),
                endLine: z.number().int().positive().optional(),
              })
              .strict(),
          )
          .max(20),
        pinnedFolder: z.boolean(),
        pinnedFile: z.boolean(),
        count: z.number().int().nonnegative(),
      })
      .strict(),

    attachments: z
      .object({
        imageCount: z.number().int().nonnegative(),
        images: z
          .array(
            z
              .object({
                mimeType: z.string().min(1).max(128),
                name: z.string().max(260).optional(),
              })
              .strict(),
          )
          .max(20),
      })
      .strict(),

    mcp: z
      .object({
        requiredServerIds: z.array(z.string().min(1).max(64)).max(10),
      })
      .strict(),

    skills: z
      .object({
        availableTags: z.array(z.string().min(1).max(64)).max(64),
      })
      .strict(),

    rulePriors: z.array(rulePriorSchema).max(3),
    sizeDraft: sizeDraftSchema,

    diagnostics: z
      .object({
        errorCount: z.number().int().nonnegative(),
        warningCount: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),

    history: z
      .object({
        digest: z.string().max(4000),
        priorRoute: z.string().max(64).optional(),
        priorTaskSize: taskSizeSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RulePrior = z.infer<typeof rulePriorSchema>;
export type SizeDraft = z.infer<typeof sizeDraftSchema>;
export type UnderstandingEvidencePack = z.infer<
  typeof understandingEvidencePackSchema
>;
