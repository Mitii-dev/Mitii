import { z } from "zod";

import { userRequestEnvelopeSchema } from "../../../request-intake";
import { requestUnderstandingResultSchema } from "../../../request-understanding";
import {
  repositoryStateReadinessSchema,
  repositoryStateReferenceSchema,
} from "../../../repository-state";

import { DECISION_POLICY_SCHEMA_VERSION } from "../../constants";
import { approvalModeSchema } from "../output/ToolGrant";

export const repositoryStateCapabilitySummarySchema = z
  .object({
    reference: repositoryStateReferenceSchema.optional(),
    readiness: repositoryStateReadinessSchema.optional(),
  })
  .strict();

export type RepositoryStateCapabilitySummary = z.infer<
  typeof repositoryStateCapabilitySummarySchema
>;

/** Host-reported optional tool backends (honest grant gating). */
export const hostCapabilityFlagsSchema = z
  .object({
    webSearch: z.boolean().optional(),
  })
  .strict();

export type HostCapabilityFlags = z.infer<typeof hostCapabilityFlagsSchema>;

export const decisionPolicyInputSchema = z
  .object({
    schemaVersion: z.literal(DECISION_POLICY_SCHEMA_VERSION),
    envelope: userRequestEnvelopeSchema,
    understanding: requestUnderstandingResultSchema,
    repositoryState: repositoryStateCapabilitySummarySchema.optional(),
    approvalMode: approvalModeSchema.optional(),
    planApproval: z.enum(["policy", "never"]).optional(),
    hostCapabilities: hostCapabilityFlagsSchema.optional(),
  })
  .strict();

export type DecisionPolicyInput = z.infer<typeof decisionPolicyInputSchema>;
