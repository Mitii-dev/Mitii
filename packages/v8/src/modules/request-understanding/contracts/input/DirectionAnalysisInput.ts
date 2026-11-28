import { z } from "zod";

import { endingPostureSchema } from "../continuity/EndingPosture";

/**
 * Input for RU.assessDirection — built from SituationPack (§5.4 A).
 * Intent rule priors intentionally omitted (S2-PRIORS).
 */
export const directionAnalysisInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    userCommand: z.string().min(1),
    mode: z.enum(["ask", "plan", "agent"]).default("agent"),
    turnKind: z
      .enum(["new", "continue", "steer", "follow_up", "recover"])
      .default("new"),
    situationSummary: z
      .object({
        focusPaths: z.array(z.string()).default([]),
        workRoot: z.string().optional(),
        readHint: z.enum(["workspace", "package", "folder"]).optional(),
        mutationFence: z.array(z.string()).optional(),
        scopeEvidence: z
          .enum(["focus_only", "explicit_limit", "safety_rule", "unclear"])
          .optional(),
        dirtyPaths: z.array(z.string()).default([]),
        windowBand: z.string().optional(),
      })
      .strict()
      .default({}),
    intentCues: z
      .object({
        readOnlyAsk: z.boolean().default(false),
        explicitEditLimit: z.boolean().default(false),
        pastedErrorOrStack: z.boolean().default(false),
        createAsk: z.boolean().default(false),
        debugAsk: z.boolean().default(false),
        constraintSnippets: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
    historyDigest: z
      .object({
        priorRoute: z.string().optional(),
        priorTaskBand: z.string().optional(),
        endingPosture: endingPostureSchema.optional(),
        digest: z.string().optional(),
      })
      .strict()
      .optional(),
    attachedSkills: z
      .array(
        z
          .object({
            id: z.string().min(1),
            required: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
    attachedMcp: z
      .array(
        z
          .object({
            serverId: z.string().min(1),
            required: z.boolean().default(false),
          })
          .strict(),
      )
      .default([]),
    candidateFiles: z
      .array(
        z
          .object({
            path: z.string().min(1),
            kind: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type DirectionAnalysisInput = z.infer<
  typeof directionAnalysisInputSchema
>;
