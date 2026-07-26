import { z } from "zod";

import {
  REPOSITORY_STATE_SCHEMA_VERSION,
} from "../../constants";

import {
  repositoryRootStateSchema,
  repositoryStateReasonSchema,
  repositoryStateScanCompletenessSchema,
} from "../output/RepositoryStateDescriptor";

/**
 * Candidate input for atomic publication. Callers supply observed revisions;
 * the pipeline derives readiness, cleanupAllowed, and stateToken.
 */
export const publishRepositoryStateInputSchema = z
  .object({
    schemaVersion: z.literal(REPOSITORY_STATE_SCHEMA_VERSION),
    workspaceId: z.string().min(1),
    snapshotId: z.string().min(1),
    roots: z.array(repositoryRootStateSchema).min(1),
    scanCompleteness: repositoryStateScanCompletenessSchema,
    reasons: z.array(repositoryStateReasonSchema).default([]),
    generatedAt: z.string().datetime().optional(),
  })
  .strict();

export type PublishRepositoryStateInput = z.infer<
  typeof publishRepositoryStateInputSchema
>;
