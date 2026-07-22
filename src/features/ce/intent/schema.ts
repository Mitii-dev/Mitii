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

export const intentClassificationSchema = z.object({
  interactionIntent: InteractionIntentEnum,
  primaryTaskIntent: taskIntentEnum,
  secondaryTaskIntents: z.array(taskIntentEnum).default([]),
  confidence: z.number().min(0).max(1),
  alternatives: z.array(intentCandidateSchema).default([]),
  needsClarification: z.boolean(),
  reason: z.string().optional(),
});

// Exported inference for use in your agent's typing
export type IntentCandidate = z.infer<typeof intentCandidateSchema>;
export type IntentClassification = z.infer<typeof intentClassificationSchema>;
export type InteractionIntent = z.infer<typeof InteractionIntentEnum>;