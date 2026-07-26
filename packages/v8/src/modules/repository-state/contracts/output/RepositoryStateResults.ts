import { z } from "zod";

import { repositoryStateErrorCodeSchema } from "../errors/RepositoryStateError";
import {
  repositoryStateDescriptorSchema,
} from "./RepositoryStateDescriptor";
import {
  repositoryStateReferenceSchema,
} from "./RepositoryStateReference";

export const publishRepositoryStateResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("published"),
        reference: repositoryStateReferenceSchema,
        descriptor: repositoryStateDescriptorSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("cancelled"),
        code: z.literal("publication_cancelled"),
        message: z.string().min(1),
      })
      .strict(),
    z
      .object({
        status: z.literal("failed"),
        code: repositoryStateErrorCodeSchema,
        message: z.string().min(1),
      })
      .strict(),
  ],
);

export type PublishRepositoryStateResult = z.infer<
  typeof publishRepositoryStateResultSchema
>;

export const readRepositoryStateResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("found"),
        descriptor: repositoryStateDescriptorSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("not_found"),
        code: z.enum(["unknown_state_token", "workspace_mismatch"]),
        message: z.string().min(1),
      })
      .strict(),
  ],
);

export type ReadRepositoryStateResult = z.infer<
  typeof readRepositoryStateResultSchema
>;

export const pinRepositoryStateResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("pinned"),
        reference: repositoryStateReferenceSchema,
        runId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        status: z.literal("failed"),
        code: z.enum(["unknown_state_token", "workspace_mismatch"]),
        message: z.string().min(1),
      })
      .strict(),
  ],
);

export type PinRepositoryStateResult = z.infer<
  typeof pinRepositoryStateResultSchema
>;

export const unpinRepositoryStateResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("unpinned"),
        reference: repositoryStateReferenceSchema,
        runId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        status: z.literal("failed"),
        code: z.literal("state_not_found"),
        message: z.string().min(1),
      })
      .strict(),
  ],
);

export type UnpinRepositoryStateResult = z.infer<
  typeof unpinRepositoryStateResultSchema
>;
