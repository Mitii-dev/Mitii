import { z } from "zod";

export const readGitStatusInputSchema = z
  .object({
    includeDiff: z.boolean().optional(),
    paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const readGitStatusOutputSchema = z
  .object({
    branch: z.string().optional(),
    staged: z.array(z.string()),
    unstaged: z.array(z.string()),
    untracked: z.array(z.string()),
    diff: z.string().optional(),
    truncated: z.boolean(),
  })
  .strict();

export const readGitLogInputSchema = z
  .object({
    maxCount: z.number().int().positive().max(100).optional(),
    paths: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();

export const readGitLogOutputSchema = z
  .object({
    entries: z.array(
      z
        .object({
          hash: z.string(),
          subject: z.string(),
          authorName: z.string().optional(),
          authorEmail: z.string().optional(),
          authoredAt: z.string().optional(),
        })
        .strict(),
    ),
    truncated: z.boolean(),
  })
  .strict();

export const readGitShowInputSchema = z
  .object({
    revision: z.string().min(1).max(256),
    path: z.string().min(1).optional(),
  })
  .strict();

export const readGitShowOutputSchema = z
  .object({
    revision: z.string(),
    content: z.string(),
    truncated: z.boolean(),
  })
  .strict();

export const readGitBranchesInputSchema = z.object({}).strict();

export const readGitBranchesOutputSchema = z
  .object({
    current: z.string().optional(),
    branches: z.array(z.string()),
    truncated: z.boolean(),
  })
  .strict();

export const memoryGraphSearchInputSchema = z
  .object({
    query: z.string().min(1).max(2048),
  })
  .strict();

export const memoryGraphEntitySchema = z
  .object({
    name: z.string().min(1),
    entityType: z.string().min(1),
    observations: z.array(z.string()).default([]),
  })
  .strict();

export const memoryGraphRelationSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    relationType: z.string().min(1),
  })
  .strict();

export const memoryGraphOutputSchema = z
  .object({
    entities: z.array(memoryGraphEntitySchema),
    relations: z.array(memoryGraphRelationSchema),
  })
  .strict();

export const memoryGraphOpenInputSchema = z
  .object({
    names: z.array(z.string().min(1)).min(1).max(50),
  })
  .strict();

export const memoryGraphUpdateInputSchema = z
  .object({
    operation: z.enum([
      "create_entities",
      "create_relations",
      "add_observations",
      "delete_entities",
      "delete_relations",
    ]),
    entities: z.array(memoryGraphEntitySchema).max(50).optional(),
    relations: z.array(memoryGraphRelationSchema).max(100).optional(),
    observations: z
      .array(
        z
          .object({
            entityName: z.string().min(1),
            contents: z.array(z.string().min(1)).min(1).max(50),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    names: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();

export const memoryGraphUpdateOutputSchema = z
  .object({
    operation: z.string(),
    result: z.unknown(),
    message: z.string(),
  })
  .strict();

