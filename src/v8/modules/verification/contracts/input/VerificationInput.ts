import { z } from "zod";

import {
  toolGrantSchema,
  verificationRequirementSchema,
} from "../../../decision-policy";
import {
  projectDescriptorSchema,
  repositoryStateReferenceSchema,
} from "../../../repository-state";

import {
  VERIFICATION_CHANGE_SCOPES,
  VERIFICATION_SCHEMA_VERSION,
} from "../../constants";

export const verificationChangeScopeSchema = z.enum(VERIFICATION_CHANGE_SCOPES);

export type VerificationChangeScope = z.infer<
  typeof verificationChangeScopeSchema
>;

/**
 * Boundary input for Verification.
 *
 * Projects come from the pinned Repository State catalog. Changed files map
 * onto those projects; checks are discovered from trusted manifests only.
 */
export const verificationInputSchema = z
  .object({
    schemaVersion: z.literal(VERIFICATION_SCHEMA_VERSION),
    workspaceRoot: z.string().min(1),
    pinnedState: repositoryStateReferenceSchema,
    changedFiles: z.array(z.string().min(1)),
    projects: z.array(projectDescriptorSchema),
    verification: verificationRequirementSchema,
    grant: toolGrantSchema,
    changeScope: verificationChangeScopeSchema.default("localized"),
    /** Published readiness of the pinned state; unavailable blocks verification. */
    stateReadiness: z
      .enum(["ready", "degraded", "unavailable"])
      .default("ready"),
  })
  .strict();

export type VerificationInput = z.infer<typeof verificationInputSchema>;
