import { z } from "zod";

import type { RepoGraph } from "../../../repository-state";
import {
  CHANGE_IMPACT_DIRECTIONS,
  CHANGE_IMPACT_EDGE_TYPES,
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../../constants";
import { CHANGE_IMPACT_POLICY } from "../../policy";

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
    includePackages: z.boolean().default(true),
    repoGraph: repoGraphReferenceSchema,
    codeIndexChangeToken: z.string().min(1).optional(),
  })
  .strict();

export type ChangeImpactSeed = z.infer<typeof changeImpactSeedSchema>;
export type ChangeImpactInput = z.input<typeof changeImpactInputSchema>;
export type ChangeImpactParsedInput = z.infer<
  typeof changeImpactInputSchema
>;
