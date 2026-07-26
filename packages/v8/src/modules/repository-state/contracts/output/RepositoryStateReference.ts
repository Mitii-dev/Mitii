import { z } from "zod";

export const repositoryStateReferenceSchema = z
  .object({
    workspaceId: z.string().min(1),
    stateToken: z.string().min(1),
  })
  .strict();

export type RepositoryStateReference = z.infer<
  typeof repositoryStateReferenceSchema
>;
