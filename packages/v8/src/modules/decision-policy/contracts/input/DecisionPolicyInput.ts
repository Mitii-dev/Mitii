import { z } from "zod";

import { userRequestEnvelopeSchema } from "../../../request-intake";
import { requestUnderstandingResultSchema } from "../../../request-understanding";
import {
  repositoryStateReadinessSchema,
  repositoryStateReferenceSchema,
} from "../../../repository-state";

import { DECISION_POLICY_SCHEMA_VERSION } from "../../constants";

export const repositoryStateCapabilitySummarySchema = z
  .object({
    reference: repositoryStateReferenceSchema.optional(),
    readiness: repositoryStateReadinessSchema.optional(),
  })
  .strict();

export type RepositoryStateCapabilitySummary = z.infer<
  typeof repositoryStateCapabilitySummarySchema
>;

export const decisionPolicyInputSchema = z
  .object({
    schemaVersion: z.literal(DECISION_POLICY_SCHEMA_VERSION),
    envelope: userRequestEnvelopeSchema,
    understanding: requestUnderstandingResultSchema,
    repositoryState: repositoryStateCapabilitySummarySchema.optional(),
  })
  .strict();

export type DecisionPolicyInput = z.infer<typeof decisionPolicyInputSchema>;
