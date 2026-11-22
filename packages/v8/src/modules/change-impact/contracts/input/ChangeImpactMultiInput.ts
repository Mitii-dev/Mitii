import { z } from "zod";

import { CHANGE_IMPACT_SCHEMA_VERSION } from "../../constants";
import { CHANGE_IMPACT_POLICY } from "../../policy";
import {
  changeImpactInputSchema,
  changeImpactSeedSchema,
} from "./ChangeImpactInput";

const sharedFields = changeImpactInputSchema.omit({ seed: true });

/**
 * Multi-seed impact input. Each seed is analyzed independently, then merged
 * conservatively (min confidence, max risk, union of affected paths).
 */
export const changeImpactMultiInputSchema = sharedFields
  .extend({
    schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
    seeds: z
      .array(changeImpactSeedSchema)
      .min(1)
      .max(CHANGE_IMPACT_POLICY.maxSeeds),
  })
  .strict();

/**
 * Counterfactual plan-check: proposed file paths (as if changed) without
 * writing the working tree. Optional expected packages gate spillover.
 */
export const changeImpactPlanCheckInputSchema = sharedFields
  .extend({
    schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
    proposedPaths: z
      .array(z.string().min(1))
      .min(1)
      .max(CHANGE_IMPACT_POLICY.maxProposedPaths),
    expectedPackages: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();

export const changeImpactSpilloverInputSchema = z
  .object({
    expectedPackages: z.array(z.string().min(1)).min(1).max(100),
    /**
     * Packages actually touched by impact (`packagesAffected` names/ids and
     * optional package roots derived from affected files).
     */
    affectedPackageIds: z.array(z.string().min(1)).default([]),
    affectedPackageNames: z.array(z.string().min(1)).default([]),
    affectedPackageRoots: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ChangeImpactMultiInput = z.input<
  typeof changeImpactMultiInputSchema
>;
export type ChangeImpactParsedMultiInput = z.infer<
  typeof changeImpactMultiInputSchema
>;
export type ChangeImpactPlanCheckInput = z.input<
  typeof changeImpactPlanCheckInputSchema
>;
export type ChangeImpactParsedPlanCheckInput = z.infer<
  typeof changeImpactPlanCheckInputSchema
>;
export type ChangeImpactSpilloverInput = z.input<
  typeof changeImpactSpilloverInputSchema
>;
export type ChangeImpactParsedSpilloverInput = z.infer<
  typeof changeImpactSpilloverInputSchema
>;
