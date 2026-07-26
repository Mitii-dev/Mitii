import { z } from "zod";

import { repositoryStateReferenceSchema } from "../../../repository-state";

import {
  DECISION_POLICY_SCHEMA_VERSION,
  DECISION_REASON_CODES,
  EXECUTION_ROUTES,
  PLANNING_DEPTHS,
  RUN_DISPOSITIONS,
  VERIFICATION_EVIDENCE_KINDS,
} from "../../constants";
import { toolGrantSchema } from "./ToolGrant";

export const executionRouteSchema = z.enum(EXECUTION_ROUTES);
export const planningDepthSchema = z.enum(PLANNING_DEPTHS);
export const runDispositionSchema = z.enum(RUN_DISPOSITIONS);
export const decisionReasonCodeSchema = z.enum(DECISION_REASON_CODES);
export const verificationEvidenceKindSchema = z.enum(
  VERIFICATION_EVIDENCE_KINDS,
);

export const verificationRequirementSchema = z
  .object({
    required: z.boolean(),
    minimumEvidence: z.array(verificationEvidenceKindSchema),
    allowUnavailable: z.boolean(),
  })
  .strict();

export type VerificationRequirement = z.infer<
  typeof verificationRequirementSchema
>;

export const executionDecisionSchema = z
  .object({
    schemaVersion: z.literal(DECISION_POLICY_SCHEMA_VERSION),
    route: executionRouteSchema,
    planningDepth: planningDepthSchema,
    runDisposition: runDispositionSchema,
    repositoryContextRequired: z.boolean(),
    pinnedState: repositoryStateReferenceSchema.optional(),
    toolGrant: toolGrantSchema,
    verification: verificationRequirementSchema,
    reasonCodes: z.array(decisionReasonCodeSchema).min(1),
    rationale: z.string().min(1),
    warnings: z.array(z.string()),
  })
  .strict();

export type ExecutionDecision = z.infer<typeof executionDecisionSchema>;
export type ExecutionRoute = z.infer<typeof executionRouteSchema>;
export type PlanningDepth = z.infer<typeof planningDepthSchema>;
export type RunDisposition = z.infer<typeof runDispositionSchema>;
export type DecisionReasonCode = z.infer<typeof decisionReasonCodeSchema>;
