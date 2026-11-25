import { z } from "zod";

import {
  CHANGE_IMPACT_BLAST_LEVELS,
  CHANGE_IMPACT_FILE_BUCKETS,
  CHANGE_IMPACT_FILE_REASONS,
  CHANGE_IMPACT_REASON_CODES,
  CHANGE_IMPACT_RISK_TIERS,
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
export const changeImpactFileBucketSchema = z.enum(CHANGE_IMPACT_FILE_BUCKETS);
export const changeImpactFileReasonSchema = z.enum(CHANGE_IMPACT_FILE_REASONS);
export const changeImpactBlastLevelSchema = z.enum(CHANGE_IMPACT_BLAST_LEVELS);
export const changeImpactRiskTierSchema = z.enum(CHANGE_IMPACT_RISK_TIERS);

export const changeImpactResolvedSeedSchema = z
  .object({
    nodeId: z.string().min(1),
    kind: z.enum(["file", "symbol", "project"]),
    relativePath: z.string().min(1).optional(),
    symbolName: z.string().min(1).optional(),
    symbolKind: z.string().min(1).optional(),
    /** 1-based start line when the seed resolved to a symbol (for LSP enrich). */
    startLine: z.number().int().positive().optional(),
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
    impactReason: changeImpactFileReasonSchema.default("direct"),
    bucket: changeImpactFileBucketSchema.default("prod"),
  })
  .strict();

/** Hop-1 neighbor counts, independent of maximumHops used for the full walk. */
export const changeImpactDirectNeighborCountsSchema = z
  .object({
    nodes: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  })
  .strict();

export const changeImpactChainLinkSchema = z
  .object({
    nodeId: z.string().min(1),
    relativePath: z.string().min(1).optional(),
    symbolName: z.string().min(1).optional(),
  })
  .strict();

export const changeImpactChainSchema = z
  .object({
    links: z.array(changeImpactChainLinkSchema).min(2),
    hop: z.number().int().positive(),
    score: z.number(),
    viaEdgeType: changeImpactEdgeTypeSchema.optional(),
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

/**
 * Full-walk totals that stay accurate when list output is later capped for
 * model-facing budgets.
 */
export const changeImpactTotalsSchema = z
  .object({
    affectedNodes: z.number().int().nonnegative(),
    affectedFiles: z.number().int().nonnegative(),
    packages: z.number().int().nonnegative(),
    chains: z.number().int().nonnegative(),
  })
  .strict();

export const changeImpactBlastRadiusSchema = z
  .object({
    level: changeImpactBlastLevelSchema,
    fragility: z.number().min(0).max(1),
    riskScore: z.number().int().min(0).max(100),
    riskTier: changeImpactRiskTierSchema,
    detail: z.string().min(1),
  })
  .strict();

export const changeImpactHiddenCouplingSchema = z
  .object({
    relativePath: z.string().min(1),
    coChangeCount: z.number().int().nonnegative(),
    churnScore: z.number().min(0).max(1).optional(),
    reason: z.string().min(1),
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
    chains: z.array(changeImpactChainSchema).default([]),
    cycles: z.array(z.array(z.string().min(1)).min(3)).default([]),
    hiddenCoupling: z.array(changeImpactHiddenCouplingSchema).default([]),
    directNeighborCounts: changeImpactDirectNeighborCountsSchema,
    totals: changeImpactTotalsSchema,
    confidence: z.number().min(0).max(1),
    confidenceNote: z.string().min(1).optional(),
    graphConfidenceUnsafe: z.boolean(),
    blastRadius: changeImpactBlastRadiusSchema,
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
export type ChangeImpactFileBucket = z.infer<
  typeof changeImpactFileBucketSchema
>;
export type ChangeImpactFileReason = z.infer<
  typeof changeImpactFileReasonSchema
>;
export type ChangeImpactBlastLevel = z.infer<
  typeof changeImpactBlastLevelSchema
>;
export type ChangeImpactRiskTier = z.infer<typeof changeImpactRiskTierSchema>;
export type ChangeImpactBlastRadius = z.infer<
  typeof changeImpactBlastRadiusSchema
>;
export type ChangeImpactTotals = z.infer<typeof changeImpactTotalsSchema>;
export type ChangeImpactHiddenCoupling = z.infer<
  typeof changeImpactHiddenCouplingSchema
>;
