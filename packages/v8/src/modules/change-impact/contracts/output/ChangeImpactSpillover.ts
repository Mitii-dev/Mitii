import { z } from "zod";

import {
  CHANGE_IMPACT_REASON_CODES,
  CHANGE_IMPACT_SCHEMA_VERSION,
  CHANGE_IMPACT_WARNING_CODES,
} from "../../constants";
import { changeImpactResultSchema } from "./ChangeImpactResult";

export const changeImpactSpilloverResultSchema = z
  .object({
    schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
    withinExpected: z.boolean(),
    expectedPackages: z.array(z.string().min(1)),
    matchedPackages: z.array(z.string().min(1)),
    spilloverPackages: z.array(z.string().min(1)),
    reasonCodes: z
      .array(z.enum(CHANGE_IMPACT_REASON_CODES))
      .min(1),
    warnings: z.array(
      z
        .object({
          code: z.enum(CHANGE_IMPACT_WARNING_CODES),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const changeImpactMergedResultSchema = changeImpactResultSchema
  .extend({
    seedCount: z.number().int().positive(),
    seedResultsTruncated: z.boolean().default(false),
  })
  .strict();

export const changeImpactPlanCheckResultSchema = z
  .object({
    schemaVersion: z.literal(CHANGE_IMPACT_SCHEMA_VERSION),
    proposedPaths: z.array(z.string().min(1)).min(1),
    merged: changeImpactMergedResultSchema,
    spillover: changeImpactSpilloverResultSchema.optional(),
    widenVerification: z.boolean(),
    reasonCodes: z.array(z.enum(CHANGE_IMPACT_REASON_CODES)).min(1),
    warnings: z.array(
      z
        .object({
          code: z.enum(CHANGE_IMPACT_WARNING_CODES),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type ChangeImpactSpilloverResult = z.infer<
  typeof changeImpactSpilloverResultSchema
>;
export type ChangeImpactMergedResult = z.infer<
  typeof changeImpactMergedResultSchema
>;
export type ChangeImpactPlanCheckResult = z.infer<
  typeof changeImpactPlanCheckResultSchema
>;
