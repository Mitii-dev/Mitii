import { z } from "zod";

import {
  CHANGE_IMPACT_REASON_CODES,
  CHANGE_IMPACT_SCHEMA_VERSION,
  CHANGE_IMPACT_STATUSES,
  CHANGE_IMPACT_WARNING_CODES,
} from "../../constants";
import {
  changeImpactDirectionSchema,
  changeImpactEdgeTypeSchema,
  changeImpactSeedSchema,
} from "../input/ChangeImpactInput";

export const changeImpactStatusSchema = z.enum(CHANGE_IMPACT_STATUSES);
export const changeImpactReasonCodeSchema = z.enum(
  CHANGE_IMPACT_REASON_CODES,
);
export const changeImpactWarningCodeSchema = z.enum(
  CHANGE_IMPACT_WARNING_CODES,
);

export const changeImpactResolvedSeedSchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.enum(["file", "symbol", "project"]),
    relativePath: z.string().min(1).optional(),
    symbolName: z.string().min(1).optional(),
    symbolKind: z.string().min(1).optional(),
  })
  .strict();

export const changeImpactAffectedNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.enum(["file", "symbol"]),
    relativePath: z.string().min(1),
    symbolName: z.string().min(1).optional(),
    symbolKind: z.string().min(1).optional(),
    hop: z.number().int().positive(),
    viaEdgeType: changeImpactEdgeTypeSchema,
    viaEdgeId: z.string().min(1).optional(),
    score: z.number(),
    evidence: z.array(z.string().min(1)).max(5).default([]),
  })
  .strict();

export const changeImpactAffectedFileSchema = z
  .object({
    relativePath: z.string().min(1),
    hop: z.number().int().positive(),
    score: z.number(),
    affectedNodeIds: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  })
  .strict();

export const changeImpactPackageSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    hop: z.number().int().nonnegative(),
    viaEdgeType: changeImpactEdgeTypeSchema.optional(),
  })
  .strict();

export const changeImpactWarningSchema = z
  .object({
    code: changeImpactWarningCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const changeImpactResultSchema = z
  .object({
    schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
    status: changeImpactStatusSchema,
    direction: changeImpactDirectionSchema,
    seed: changeImpactSeedSchema,
    resolvedSeeds: z.array(changeImpactResolvedSeedSchema),
    affected: z.array(changeImpactAffectedNodeSchema),
    affectedFiles: z.array(changeImpactAffectedFileSchema),
    packagesAffected: z.array(changeImpactPackageSchema).default([]),
    truncated: z.boolean(),
    warnings: z.array(changeImpactWarningSchema),
    reasonCodes: z.array(changeImpactReasonCodeSchema).min(1),
    graphRevision: z.string().min(1).optional(),
    codeIndexChangeToken: z.string().min(1).optional(),
  })
  .strict();

export type ChangeImpactResult = z.infer<typeof changeImpactResultSchema>;
export type ChangeImpactStatus = z.infer<typeof changeImpactStatusSchema>;
export type ChangeImpactReasonCode = z.infer<
  typeof changeImpactReasonCodeSchema
>;
export type ChangeImpactWarningCode = z.infer<
  typeof changeImpactWarningCodeSchema
>;
