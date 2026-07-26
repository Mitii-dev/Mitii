import { z } from "zod";

import { repositoryStateReferenceSchema } from "../output/RepositoryStateReference";

export const readRepositoryStateInputSchema =
  repositoryStateReferenceSchema;

export type ReadRepositoryStateInput = z.infer<
  typeof readRepositoryStateInputSchema
>;

export const pinRepositoryStateInputSchema = z
  .object({
    state: repositoryStateReferenceSchema,
    runId: z.string().min(1),
  })
  .strict();

export type PinRepositoryStateInput = z.infer<
  typeof pinRepositoryStateInputSchema
>;

export const unpinRepositoryStateInputSchema =
  pinRepositoryStateInputSchema;

export type UnpinRepositoryStateInput = z.infer<
  typeof unpinRepositoryStateInputSchema
>;
