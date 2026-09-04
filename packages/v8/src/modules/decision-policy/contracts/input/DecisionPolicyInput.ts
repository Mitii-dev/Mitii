import { z } from "zod";

import { userRequestEnvelopeSchema } from "../../../request-intake";
import { requestUnderstandingResultSchema } from "../../../request-understanding";
import {
  repositoryStateReadinessSchema,
  repositoryStateReferenceSchema,
} from "../../../repository-state";
import { windowPolicySchema } from "../../../window-budget";

import { DECISION_POLICY_SCHEMA_VERSION } from "../../constants";
import { approvalModeSchema } from "../output/ToolGrant";
import { userSafetyRulesSchema } from "./UserSafetyRules";

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

export {
  userSafetyRulesSchema,
  DISABLED_USER_SAFETY_RULES,
} from "./UserSafetyRules";
export type { UserSafetyRules } from "./UserSafetyRules";

export const decisionPolicyInputSchema = z
  .object({
    schemaVersion: z.literal(DECISION_POLICY_SCHEMA_VERSION),
    envelope: userRequestEnvelopeSchema,
    understanding: requestUnderstandingResultSchema,
    repositoryState: repositoryStateCapabilitySummarySchema.optional(),
    approvalMode: approvalModeSchema.optional(),
    planApproval: z.enum(["policy", "never"]).optional(),
    hostCapabilities: hostCapabilityFlagsSchema.optional(),
    /**
     * Derived window allocation. When omitted, Decision Policy keeps
     * historical large-window affordances (visible plan + change-impact).
     */
    windowPolicy: windowPolicySchema.optional(),
    /**
     * Optional tighten-only user rules (from `.mitii/safety.json`).
     * Ignored unless `enabled: true`. Never widens the policy grant.
     */
    userSafetyRules: userSafetyRulesSchema.optional(),
  })
  .strict();

export type DecisionPolicyInput = z.infer<typeof decisionPolicyInputSchema>;
