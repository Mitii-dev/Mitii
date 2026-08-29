import { z } from 'zod';
import { INTENT_CONSTANTS } from './constants';

const taskIntentEnum = z.enum(INTENT_CONSTANTS.TASK_INTENTS);
export const intentCandidateSchema = z.object({
  intent: taskIntentEnum,
  confidence: z.number().min(0).max(1),
});

export const InteractionIntentEnum = z.enum([
  'question',
  'plan',
  'act',
  'help',
  'unknown',
]);

/**
 * Optional evidence hints from the understanding LLM call.
 * Recommendations only — never grants, routes, or selected skill IDs.
 */
export const understandingTaskHintsSchema = z
  .object({
    targets: z
      .array(
        z.object({
          kind: z.enum([
            'file',
            'folder',
            'symbol',
            'package',
            'repository',
            'workspace',
            'unknown',
          ]),
          value: z.string().min(1).max(500),
          explicit: z.boolean().default(true),
        }),
      )
      .max(20)
      .default([]),
    constraints: z.array(z.string().min(1).max(500)).max(20).default([]),
    requestedOutcomes: z.array(z.string().min(1).max(500)).max(20).default([]),
    clarity: z.enum(['clear', 'partially_clear', 'unclear']).optional(),
    ambiguityQuestion: z.string().min(1).max(500).optional(),
    /** Soft tags for Skills matching — never sole selection authority. */
    recommendedSkillTags: z
      .array(z.string().min(1).max(64))
      .max(10)
      .default([]),
  })
  .strict();

export const intentClassificationSchema = z.object({
  interactionIntent: InteractionIntentEnum,
  primaryTaskIntent: taskIntentEnum,
  secondaryTaskIntents: z.array(taskIntentEnum).default([]),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(intentCandidateSchema).default([]),
  needsClarification: z.boolean(),
  reason: z.string().optional(),
  taskHints: understandingTaskHintsSchema.optional(),
});

// Exported inference for use in your agent's typing
export type IntentCandidate = z.infer<typeof intentCandidateSchema>;
export type IntentClassification = z.infer<typeof intentClassificationSchema>;
export type InteractionIntent = z.infer<typeof InteractionIntentEnum>;
export type UnderstandingTaskHints = z.infer<
  typeof understandingTaskHintsSchema
>;
