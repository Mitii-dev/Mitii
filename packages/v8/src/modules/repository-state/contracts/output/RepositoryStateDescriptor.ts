import { z } from "zod";

import {
  REPOSITORY_CAPABILITY_IDS,
  REPOSITORY_CAPABILITY_STATUSES,
  REPOSITORY_STATE_READINESS,
  REPOSITORY_STATE_REASON_CODES,
  REPOSITORY_STATE_SCAN_COMPLETENESS,
  REPOSITORY_STATE_SCHEMA_VERSION,
} from "../../constants";

export const repositoryCapabilityIdSchema = z.enum(
  REPOSITORY_CAPABILITY_IDS,
);

export const repositoryCapabilityStatusLevelSchema = z.enum(
  REPOSITORY_CAPABILITY_STATUSES,
);

export const repositoryCapabilityStatusSchema = z
  .object({
    capability: repositoryCapabilityIdSchema,
    status: repositoryCapabilityStatusLevelSchema,
    reasonCode: z.enum(REPOSITORY_STATE_REASON_CODES).optional(),
  })
  .strict();

export type RepositoryCapabilityStatus = z.infer<
  typeof repositoryCapabilityStatusSchema
>;

export const repositoryRootStateSchema = z
  .object({
    rootId: z.string().min(1),
    projectCatalogRevision: z.string().min(1),
    codeIndexRevision: z.string().min(1).optional(),
    textIndexRevision: z.string().min(1).optional(),
    vectorProfile: z.string().min(1).optional(),
    vectorIndexRevision: z.string().min(1).optional(),
    graphRevision: z.string().min(1).optional(),
    mapRevision: z.string().min(1).optional(),
    capabilities: z.array(repositoryCapabilityStatusSchema).min(1),
  })
  .strict();

export type RepositoryRootState = z.infer<typeof repositoryRootStateSchema>;

export const repositoryStateReasonCodeSchema = z.enum(
  REPOSITORY_STATE_REASON_CODES,
);

export const repositoryStateReasonSchema = z
  .object({
    code: repositoryStateReasonCodeSchema,
    message: z.string().min(1),
    rootId: z.string().min(1).optional(),
  })
  .strict();

export type RepositoryStateReason = z.infer<
  typeof repositoryStateReasonSchema
>;

export const repositoryStateReadinessSchema = z.enum(
  REPOSITORY_STATE_READINESS,
);

export type RepositoryStateReadiness = z.infer<
  typeof repositoryStateReadinessSchema
>;

export const repositoryStateScanCompletenessSchema = z.enum(
  REPOSITORY_STATE_SCAN_COMPLETENESS,
);

export type RepositoryStateScanCompleteness = z.infer<
  typeof repositoryStateScanCompletenessSchema
>;

export const repositoryStateDescriptorSchema = z
  .object({
    schemaVersion: z.literal(REPOSITORY_STATE_SCHEMA_VERSION),
    workspaceId: z.string().min(1),
    stateToken: z.string().min(1),
    snapshotId: z.string().min(1),
    roots: z.array(repositoryRootStateSchema).min(1),
    readiness: repositoryStateReadinessSchema,
    reasons: z.array(repositoryStateReasonSchema),
    generatedAt: z.string().datetime(),
    scanCompleteness: repositoryStateScanCompletenessSchema,
    cleanupAllowed: z.boolean(),
  })
  .strict();

export type RepositoryStateDescriptor = z.infer<
  typeof repositoryStateDescriptorSchema
>;
