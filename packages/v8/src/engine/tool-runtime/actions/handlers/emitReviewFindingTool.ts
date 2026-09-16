import { z } from "zod";

import {
  REVIEW_CATEGORIES,
  REVIEW_SEVERITIES,
  repairFindingArgs,
} from "../../../../modules/review";
import type { RegisteredTool } from "../../internal/ToolRegistry";
import { defineTool } from "../../internal/ToolCatalog";

export const emitReviewFindingInputSchema = z
  .object({
    path: z.string().min(1),
    content: z.string().min(1),
    existingCode: z.string().min(1),
    suggestionCode: z.string().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    category: z.enum(REVIEW_CATEGORIES).optional(),
    severity: z.enum(REVIEW_SEVERITIES).optional(),
  })
  .strict();

export const emitReviewFindingOutputSchema = z
  .object({
    accepted: z.boolean(),
    finding: z
      .object({
        path: z.string(),
        content: z.string(),
        existingCode: z.string(),
        suggestionCode: z.string().optional(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
        category: z.enum(REVIEW_CATEGORIES),
        severity: z.enum(REVIEW_SEVERITIES),
        anchored: z.boolean(),
      })
      .strict()
      .optional(),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

export const emitReviewFindingTool: RegisteredTool = {
  definition: defineTool({
    name: "emit_review_finding",
    effects: ["workspace_read"],
    description:
      "Emit one structured code-review finding with an existingCode anchor. Prefer severity critical/high/medium/low and categories bug|security|performance|maintainability|test|style|documentation|other. Call once per finding.",
    inputSchema: emitReviewFindingInputSchema,
    outputSchema: emitReviewFindingOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path for the finding.",
        },
        content: {
          type: "string",
          description: "Human-readable finding message.",
        },
        existingCode: {
          type: "string",
          description:
            "Exact code snippet from the file used to anchor the finding.",
        },
        suggestionCode: {
          type: "string",
          description: "Optional suggested replacement code.",
        },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
        category: {
          type: "string",
          enum: [...REVIEW_CATEGORIES],
        },
        severity: {
          type: "string",
          enum: [...REVIEW_SEVERITIES],
        },
      },
      required: ["path", "content", "existingCode"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    const { findings, warnings } = repairFindingArgs(ctx.arguments);
    const finding = findings[0];
    if (!finding) {
      return Promise.resolve({
        output: emitReviewFindingOutputSchema.parse({
          accepted: false,
          warnings: warnings.map((w: { message: string }) => w.message),
        }),
        truncated: false,
        redacted: false,
      });
    }
    return Promise.resolve({
      output: emitReviewFindingOutputSchema.parse({
        accepted: true,
        finding: {
          path: finding.path,
          content: finding.content,
          existingCode: finding.existingCode,
          suggestionCode: finding.suggestionCode,
          startLine: finding.startLine,
          endLine: finding.endLine,
          category: finding.category,
          severity: finding.severity,
          anchored: finding.anchored,
        },
        warnings: warnings.map((w: { message: string }) => w.message),
      }),
      truncated: false,
      redacted: false,
    });
  },
};
