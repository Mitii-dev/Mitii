import { z } from "zod";

import {
  CODE_NAVIGATION_OPERATIONS,
  CODE_NAVIGATION_SCHEMA_VERSION,
} from "../../constants";
import { CODE_NAVIGATION_POLICY } from "../../policy";

export const codeNavigationOperationSchema = z.enum(
  CODE_NAVIGATION_OPERATIONS,
);

export const codeNavigationLocationSchema = z
  .object({
    rootId: z.string().min(1).optional(),
    relativePath: z.string().min(1),
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    endColumn: z.number().int().positive().optional(),
    symbolName: z.string().min(1).optional(),
    symbolKind: z.string().min(1).optional(),
    preview: z.string().min(1).optional(),
  })
  .strict();

export type CodeNavigationLocation = z.infer<
  typeof codeNavigationLocationSchema
>;

export const codeNavigationHoverSchema = z
  .object({
    contents: z.string().min(1),
    language: z.string().min(1).optional(),
  })
  .strict();

export type CodeNavigationHover = z.infer<typeof codeNavigationHoverSchema>;

export const codeNavigationQuerySchema = z
  .object({
    rootId: z.string().min(1).optional(),
    relativePath: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().positive().default(1),
    symbolName: z.string().min(1).optional(),
    includeDeclaration: z.boolean().optional(),
    direction: z.enum(["incoming", "outgoing"]).optional(),
  })
  .strict();

export type CodeNavigationQuery = z.infer<typeof codeNavigationQuerySchema>;

/** File-scoped symbol list. Line is not required. */
export const codeNavigationDocumentQuerySchema = z
  .object({
    rootId: z.string().min(1).optional(),
    relativePath: z.string().min(1),
  })
  .strict();

export type CodeNavigationDocumentQuery = z.infer<
  typeof codeNavigationDocumentQuerySchema
>;

/** Workspace symbol search. Query is a name fragment, not a caret. */
export const codeNavigationWorkspaceQuerySchema = z
  .object({
    rootId: z.string().min(1).optional(),
    query: z.string().min(1),
  })
  .strict();

export type CodeNavigationWorkspaceQuery = z.infer<
  typeof codeNavigationWorkspaceQuerySchema
>;

export const codeNavigationInputSchema = z
  .object({
    schemaVersion: z.literal(CODE_NAVIGATION_SCHEMA_VERSION),
    operation: codeNavigationOperationSchema,
    query: z.union([
      codeNavigationQuerySchema,
      codeNavigationDocumentQuerySchema,
      codeNavigationWorkspaceQuerySchema,
    ]),
    maximumLocations: z
      .number()
      .int()
      .positive()
      .max(CODE_NAVIGATION_POLICY.maximumLocations)
      .default(CODE_NAVIGATION_POLICY.maximumLocations),
  })
  .strict();

export type CodeNavigationInput = z.input<typeof codeNavigationInputSchema>;
export type CodeNavigationParsedInput = z.infer<typeof codeNavigationInputSchema>;
