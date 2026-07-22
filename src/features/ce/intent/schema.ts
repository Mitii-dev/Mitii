import { z } from 'zod';
import { INTENT_CONSTANTS } from './constants';

const taskIntentEnum = z.enum(INTENT_CONSTANTS.TASK_INTENTS);
export const intentCandidateSchema = z.object({
  intent: taskIntentEnum,
  confidence: z.number().min(0).max(1),
});

export const intentClassificationSchema = z.object({
  interactionIntent: z.enum([
    'question',
    'plan',
    'act',
    'help',
    'unknown',
  ]),

  // Updated to match the 20-item standard intent catalog
  primaryTaskIntent: taskIntentEnum,

  // Replaced generic z.string() with strict intent typing
  secondaryTaskIntents: z.array(taskIntentEnum).default([]),

  confidence: z.number().min(0).max(1),
  
  alternatives: z.array(intentCandidateSchema).default([]),

  needsClarification: z.boolean(),
  reason: z.string().optional(),
});

// Exported inference for use in your agent's typing
export type IntentCandidate = z.infer<typeof intentCandidateSchema>;
export type IntentClassification = z.infer<typeof intentClassificationSchema>;