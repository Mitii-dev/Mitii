import { z } from "zod";

import { INTENT_CONSTANTS } from "../../helpers/intent/constants";

const taskIntentEnum = z.enum(INTENT_CONSTANTS.TASK_INTENTS);

/**
 * LLM ballot only — Decision Policy owns authority (§5.4 B).
 * Compat: askUser mirrors askUserSuggested for one release.
 */
export const taskDirectionAssessmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    interactionIntent: z
      .enum(["question", "plan", "act", "help", "unknown"])
      .default("unknown"),
    primaryTaskIntent: z.union([taskIntentEnum, z.literal("unclear")]),
    secondaryTaskIntents: z.array(taskIntentEnum).default([]),
    difficulty: z
      .enum(["trivial", "simple", "moderate", "complex", "very_complex"])
      .default("simple"),
    taskBand: z.enum(["small", "medium", "large"]).default("small"),
    risk: z.enum(["low", "medium", "high", "critical"]).default("low"),
    scope: z
      .enum([
        "single_location",
        "multi_file",
        "package",
        "repository",
        "workspace",
        "unknown",
      ])
      .default("unknown"),
    planningHint: z.enum(["none", "short", "medium", "long"]).default("none"),
    filesToRead: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              path: z.string().min(1),
              reason: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
            })
            .strict(),
        ]),
      )
      .default([]),
    affectedFiles: z
      .array(
        z
          .object({
            path: z.string().min(1),
            changeType: z
              .enum(["create", "modify", "delete", "inspect"])
              .default("modify"),
            confidence: z.number().min(0).max(1).default(0.5),
          })
          .strict(),
      )
      .default([]),
    userQuestions: z.array(z.string()).default([]),
    clarityConfidence: z.union([
      z.enum(["low", "medium", "high"]),
      z.number().min(0).max(1),
    ]),
    /** Ballot suggestion only — DP owns final ask. */
    askUserSuggested: z.boolean().default(false),
    /** @deprecated Prefer askUserSuggested — kept for plate select compat. */
    askUser: z.boolean().default(false),
    clarificationQuestions: z
      .array(
        z
          .object({
            question: z.string().min(1),
            slotKind: z.string().optional(),
            blocking: z.boolean().default(true),
          })
          .strict(),
      )
      .default([]),
    assumptionsMade: z.array(z.string()).default([]),
    skillsAndMcp: z
      .object({
        matchedSkillIds: z.array(z.string()).default([]),
        matchedMcpIds: z.array(z.string()).default([]),
        missingCapabilityNote: z.string().optional(),
      })
      .strict()
      .optional(),
    rationale: z.string().optional(),
    reasonCodes: z.array(z.string()).default([]),
  })
  .strict()
  .transform((value) => {
    // Keep askUser ↔ askUserSuggested aligned for consumers.
    const suggested = value.askUserSuggested || value.askUser;
    const clarity =
      typeof value.clarityConfidence === "number"
        ? value.clarityConfidence < 0.35
          ? "low"
          : value.clarityConfidence < 0.7
            ? "medium"
            : "high"
        : value.clarityConfidence;
    return {
      ...value,
      askUserSuggested: suggested,
      askUser: suggested,
      clarityConfidence: clarity as "low" | "medium" | "high",
    };
  });

export type TaskDirectionAssessment = z.infer<
  typeof taskDirectionAssessmentSchema
>;
