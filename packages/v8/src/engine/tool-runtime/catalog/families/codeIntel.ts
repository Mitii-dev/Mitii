import { z } from "zod";

import {
  CHANGE_IMPACT_DIRECTIONS,
  CHANGE_IMPACT_EDGE_TYPES,
  CHANGE_IMPACT_FILE_BUCKETS,
  CHANGE_IMPACT_POLICY,
  CHANGE_IMPACT_SEED_EXPANSIONS,
  CHANGE_IMPACT_STATUSES,
} from "../../../../modules/change-impact";

export const gotoDefinitionInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
  })
  .strict();

export const findReferencesInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
    includeDeclaration: z.boolean().optional(),
  })
  .strict();

export const codeNavigationLocationOutputSchema = z
  .object({
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().optional(),
    symbolKind: z.string().optional(),
    preview: z.string().optional(),
  })
  .strict();

export const gotoDefinitionOutputSchema = z
  .object({
    path: z.string(),
    locations: z.array(codeNavigationLocationOutputSchema),
    provider: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const findReferencesOutputSchema = gotoDefinitionOutputSchema;

export const hoverSymbolInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
  })
  .strict();

export const hoverSymbolOutputSchema = z
  .object({
    path: z.string(),
    provider: z.string(),
    hover: z
      .object({
        contents: z.string(),
        language: z.string().optional(),
      })
      .optional(),
    truncated: z.boolean(),
  })
  .strict();

export const documentSymbolInputSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export const workspaceSymbolInputSchema = z
  .object({
    query: z.string().min(1),
  })
  .strict();

export const findImplementationInputSchema = gotoDefinitionInputSchema;

export const findTypeDefinitionInputSchema = gotoDefinitionInputSchema;

export const callHierarchyInputSchema = gotoDefinitionInputSchema.extend({
  direction: z.enum(["incoming", "outgoing"]).optional(),
});

export const symbolLocationsOutputSchema = gotoDefinitionOutputSchema;

export const analyzeChangeImpactInputSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
    maximumHops: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumHopsCap)
      .optional(),
    maximumAffectedNodes: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumAffectedNodesCap)
      .optional(),
    maximumPaths: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumPathsCap)
      .optional(),
    includePackages: z.boolean().optional(),
    seedExpansion: z.enum(CHANGE_IMPACT_SEED_EXPANSIONS).optional(),
    direction: z.enum(CHANGE_IMPACT_DIRECTIONS).optional(),
    edgeTypes: z
      .array(z.enum(CHANGE_IMPACT_EDGE_TYPES))
      .min(1)
      .max(CHANGE_IMPACT_EDGE_TYPES.length)
      .optional(),
    pathIdentityOverlays: z
      .array(
        z
          .object({
            kind: z.enum(["renamed", "deleted"]),
            fromRelativePath: z.string().min(1),
            toRelativePath: z.string().min(1).optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
    historicalCoupling: z
      .array(
        z
          .object({
            relativePath: z.string().min(1),
            coChangeCount: z.number().int().nonnegative(),
            churnScore: z.number().min(0).max(1).optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.column !== undefined && value.line === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "line is required when column is set",
        path: ["line"],
      });
    }
    for (const [index, overlay] of (value.pathIdentityOverlays ?? []).entries()) {
      if (overlay.kind === "renamed" && !overlay.toRelativePath) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "toRelativePath is required when kind is renamed",
          path: ["pathIdentityOverlays", index, "toRelativePath"],
        });
      }
    }
  });

export const analyzeChangeImpactOutputSchema = z
  .object({
    path: z.string(),
    provider: z.literal("repo_graph"),
    status: z.enum(CHANGE_IMPACT_STATUSES),
    resolvedSeeds: z.array(
      z
        .object({
          kind: z.enum(["file", "symbol", "project"]),
          path: z.string().optional(),
          symbolName: z.string().optional(),
          symbolKind: z.string().optional(),
        })
        .strict(),
    ),
    affected: z.array(
      z
        .object({
          path: z.string(),
          symbolName: z.string().optional(),
          symbolKind: z.string().optional(),
          hop: z.number().int().positive(),
          viaEdgeType: z.enum(CHANGE_IMPACT_EDGE_TYPES),
          score: z.number(),
          evidence: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    affectedFiles: z.array(
      z
        .object({
          path: z.string(),
          hop: z.number().int().positive(),
          score: z.number(),
          affectedNodeCount: z.number().int().positive(),
          reason: z.string(),
          impactReason: z.string().optional(),
          bucket: z.enum(CHANGE_IMPACT_FILE_BUCKETS).optional(),
        })
        .strict(),
    ),
    packagesAffected: z.array(
      z
        .object({
          name: z.string(),
          projectId: z.string(),
          hop: z.number().int().nonnegative(),
          viaEdgeType: z.enum(CHANGE_IMPACT_EDGE_TYPES).optional(),
        })
        .strict(),
    ),
    chains: z.array(z.string()).optional(),
    directNeighborCounts: z
      .object({
        nodes: z.number().int().nonnegative(),
        files: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    totals: z
      .object({
        affectedNodes: z.number().int().nonnegative(),
        affectedFiles: z.number().int().nonnegative(),
        packages: z.number().int().nonnegative(),
        chains: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    confidenceNote: z.string().optional(),
    graphConfidenceUnsafe: z.boolean().optional(),
    blastRadius: z
      .object({
        level: z.enum(["low", "medium", "high"]),
        fragility: z.number().min(0).max(1),
        riskScore: z.number().int().min(0).max(100),
        riskTier: z.enum(["safe", "review", "test", "critical"]),
        detail: z.string(),
      })
      .strict()
      .optional(),
    widenVerification: z.boolean().optional(),
    cycles: z.array(z.array(z.string())).optional(),
    hiddenCoupling: z
      .array(
        z
          .object({
            relativePath: z.string(),
            coChangeCount: z.number().int().nonnegative(),
            churnScore: z.number().optional(),
            reason: z.string(),
          })
          .strict(),
      )
      .optional(),
    truncated: z.boolean(),
    warnings: z.array(
      z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .strict(),
    ),
    reasonCodes: z.array(z.string()).min(1),
    graphRevision: z.string().optional(),
    codeIndexChangeToken: z.string().optional(),
  })
  .strict();

export const planCheckChangeImpactInputSchema = z
  .object({
    proposedPaths: z.array(z.string().min(1)).min(1).max(40),
    expectedPackages: z.array(z.string().min(1)).max(100).optional(),
    maximumHops: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumHopsCap)
      .optional(),
    maximumAffectedNodes: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumAffectedNodesCap)
      .optional(),
    maximumPaths: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumPathsCap)
      .optional(),
    includePackages: z.boolean().optional(),
    direction: z.enum(CHANGE_IMPACT_DIRECTIONS).optional(),
    edgeTypes: z
      .array(z.enum(CHANGE_IMPACT_EDGE_TYPES))
      .min(1)
      .max(CHANGE_IMPACT_EDGE_TYPES.length)
      .optional(),
  })
  .strict();

export const planCheckChangeImpactOutputSchema = z
  .object({
    proposedPaths: z.array(z.string().min(1)).min(1),
    provider: z.literal("repo_graph"),
    status: z.enum(CHANGE_IMPACT_STATUSES),
    affectedFiles: z.array(
      z
        .object({
          path: z.string(),
          hop: z.number().int().positive(),
          score: z.number(),
          affectedNodeCount: z.number().int().positive(),
          reason: z.string(),
          impactReason: z.string().optional(),
          bucket: z.enum(CHANGE_IMPACT_FILE_BUCKETS).optional(),
        })
        .strict(),
    ),
    packagesAffected: z.array(
      z
        .object({
          name: z.string(),
          projectId: z.string(),
          hop: z.number().int().nonnegative(),
          viaEdgeType: z.enum(CHANGE_IMPACT_EDGE_TYPES).optional(),
        })
        .strict(),
    ),
    spillover: z
      .object({
        withinExpected: z.boolean(),
        expectedPackages: z.array(z.string().min(1)),
        matchedPackages: z.array(z.string().min(1)),
        spilloverPackages: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    confidence: z.number().min(0).max(1).optional(),
    graphConfidenceUnsafe: z.boolean().optional(),
    blastRadius: z
      .object({
        level: z.enum(["low", "medium", "high"]),
        fragility: z.number().min(0).max(1),
        riskScore: z.number().int().min(0).max(100),
        riskTier: z.enum(["safe", "review", "test", "critical"]),
        detail: z.string(),
      })
      .strict()
      .optional(),
    widenVerification: z.boolean(),
    truncated: z.boolean(),
    warnings: z.array(
      z
        .object({
          code: z.string(),
          message: z.string(),
        })
        .strict(),
    ),
    reasonCodes: z.array(z.string()).min(1),
  })
  .strict();

