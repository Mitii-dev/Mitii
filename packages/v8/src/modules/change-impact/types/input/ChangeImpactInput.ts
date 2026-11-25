import { z } from "zod";

import type { RepoGraph } from "../../../repository-state";
import {
  CHANGE_IMPACT_DIRECTIONS,
  CHANGE_IMPACT_EDGE_TYPES,
  CHANGE_IMPACT_PATH_IDENTITY_KINDS,
  CHANGE_IMPACT_SCHEMA_VERSION,
  CHANGE_IMPACT_SEED_EXPANSIONS,
} from "../../constants";
import { CHANGE_IMPACT_POLICY } from "../../rules";

export const changeImpactFileSeedSchema = z
  .object({
    kind: z.literal("file"),
    relativePath: z.string().min(1),
    rootId: z.string().min(1).optional(),
  })
  .strict();

export const changeImpactSymbolSeedSchema = z
  .object({
    kind: z.literal("symbol"),
    relativePath: z.string().min(1),
    symbolName: z.string().min(1),
    rootId: z.string().min(1).optional(),
    startLine: z.number().int().positive().optional(),
  })
  .strict();

export const changeImpactCaretSeedSchema = z
  .object({
    kind: z.literal("caret"),
    relativePath: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().default(1),
    symbolName: z.string().min(1).optional(),
    rootId: z.string().min(1).optional(),
  })
  .strict();

export const changeImpactSeedSchema = z.discriminatedUnion("kind", [
  changeImpactFileSeedSchema,
  changeImpactSymbolSeedSchema,
  changeImpactCaretSeedSchema,
]);

export const changeImpactEdgeTypeSchema = z.enum(CHANGE_IMPACT_EDGE_TYPES);
export const changeImpactDirectionSchema = z.enum(CHANGE_IMPACT_DIRECTIONS);
export const changeImpactSeedExpansionSchema = z.enum(
  CHANGE_IMPACT_SEED_EXPANSIONS,
);

export const changeImpactPathIdentityKindSchema = z.enum(
  CHANGE_IMPACT_PATH_IDENTITY_KINDS,
);

/**
 * Host-supplied path identity facts (for example from a diff). Used to keep
 * dependents of renamed/deleted paths reachable without inventing graph edges.
 */
export const changeImpactPathIdentityOverlaySchema = z
  .object({
    kind: changeImpactPathIdentityKindSchema,
    fromRelativePath: z.string().min(1),
    toRelativePath: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "renamed" && !value.toRelativePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "toRelativePath is required when kind is renamed",
        path: ["toRelativePath"],
      });
    }
  });

/**
 * Host-published historical coupling for one path relative to the seed.
 * Change-impact never computes git history — it only applies capped boosts.
 */
export const changeImpactHistoricalCouplingEntrySchema = z
  .object({
    relativePath: z.string().min(1),
    coChangeCount: z.number().int().nonnegative(),
    churnScore: z.number().min(0).max(1).optional(),
  })
  .strict();

const repoGraphReferenceSchema = z.custom<RepoGraph>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1,
  { message: "Expected a validated RepoGraph." },
);

export const changeImpactInputSchema = z
  .object({
    schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
    seed: changeImpactSeedSchema,
    direction: changeImpactDirectionSchema.default("dependents"),
    edgeTypes: z
      .array(changeImpactEdgeTypeSchema)
      .min(1)
      .max(CHANGE_IMPACT_EDGE_TYPES.length)
      .default([...CHANGE_IMPACT_POLICY.defaultEdgeTypes]),
    maximumHops: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumHopsCap)
      .default(CHANGE_IMPACT_POLICY.maximumHops),
    maximumAffectedNodes: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumAffectedNodesCap)
      .default(CHANGE_IMPACT_POLICY.maximumAffectedNodes),
    maximumPaths: z
      .number()
      .int()
      .positive()
      .max(CHANGE_IMPACT_POLICY.maximumPathsCap)
      .default(CHANGE_IMPACT_POLICY.maximumPaths),
    includePackages: z.boolean().default(true),
    seedExpansion: changeImpactSeedExpansionSchema.default(
      CHANGE_IMPACT_POLICY.seedExpansion,
    ),
    /**
     * Optional published RepoMap importance by relative path (PageRank or
     * composite score). Never recomputed here — hosts pass published values.
     */
    importanceByRelativePath: z
      .record(z.string().min(1), z.number().nonnegative())
      .optional(),
    /**
     * Host text-search / occurrence hints (1-based lines) used when exact
     * symbol seed resolution fails.
     */
    textOccurrenceHints: z
      .array(
        z
          .object({
            line: z.number().int().positive(),
            symbolName: z.string().min(1).optional(),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    /**
     * Optional rename/delete path overlays from the host. Remaps seeds and
     * dual-seeds retained prior paths when those file nodes still exist.
     */
    pathIdentityOverlays: z
      .array(changeImpactPathIdentityOverlaySchema)
      .max(200)
      .optional(),
    historicalCoupling: z
      .array(changeImpactHistoricalCouplingEntrySchema)
      .max(200)
      .optional(),
    repoGraph: repoGraphReferenceSchema,
    codeIndexChangeToken: z.string().min(1).optional(),
  })
  .strict();

export type ChangeImpactSeed = z.infer<typeof changeImpactSeedSchema>;
export type ChangeImpactPathIdentityOverlay = z.infer<
  typeof changeImpactPathIdentityOverlaySchema
>;
export type ChangeImpactHistoricalCouplingEntry = z.infer<
  typeof changeImpactHistoricalCouplingEntrySchema
>;
export type ChangeImpactInput = z.input<typeof changeImpactInputSchema>;
export type ChangeImpactParsedInput = z.infer<
  typeof changeImpactInputSchema
>;
