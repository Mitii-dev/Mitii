import { z } from "zod";

import { REPO_GRAPH_SCHEMA_VERSION } from "./constants";

/**
 * SHARED SCHEMAS
 */

const canonicalRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("\\") &&
      !value
        .split("/")
        .some((segment) => !segment || segment === "." || segment === ".."),
    {
      message: "Expected a canonical workspace-relative path.",
    },
  );

const canonicalRelativeRootSchema = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      (!value.startsWith("/") &&
        !value.endsWith("/") &&
        !value.includes("\\") &&
        !value
          .split("/")
          .some((segment) => !segment || segment === "." || segment === "..")),
    {
      message: "Expected a canonical workspace-relative project root.",
    },
  );

const uniqueStringArraySchema = z
  .array(z.string().min(1))
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique.",
  });

/**
 * NODE SCHEMAS
 */

export const repoGraphProjectNodeSchema = z
  .object({
    id: z.string().min(1),

    kind: z.literal("project"),

    projectId: z.string().min(1),

    rootId: z.string().min(1),

    relativeRoot: canonicalRelativeRootSchema,

    name: z.string().min(1),

    ecosystems: uniqueStringArraySchema,
  })
  .strict();

export const repoGraphFileNodeSchema = z
  .object({
    id: z.string().min(1),

    kind: z.literal("file"),

    fileId: z.string().min(1),

    rootId: z.string().min(1),

    relativePath: canonicalRelativePathSchema,

    projectId: z.string().min(1).optional(),

    language: z.string().min(1).optional(),

    size: z.number().nonnegative().optional(),

    modifiedAt: z.string().datetime().optional(),

    contentHash: z.string().min(1).optional(),
  })
  .strict();

const repoGraphSymbolNodeBaseSchema = z
  .object({
    id: z.string().min(1),

    kind: z.literal("symbol"),

    symbolId: z.string().min(1),

    fileId: z.string().min(1),

    name: z.string().min(1),

    symbolKind: z.string().min(1),

    exported: z.boolean().optional(),

    signature: z.string().min(1).optional(),

    startLine: z.number().int().positive().optional(),

    endLine: z.number().int().positive().optional(),
  })
  .strict();

export const repoGraphSymbolNodeSchema = repoGraphSymbolNodeBaseSchema
  .superRefine((symbol, context) => {
    if (
      symbol.startLine !== undefined &&
      symbol.endLine !== undefined &&
      symbol.endLine < symbol.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["endLine"],

        message: "endLine must be greater than or equal to startLine.",
      });
    }
  });

export const repoGraphNodeSchema = z.discriminatedUnion("kind", [
  repoGraphProjectNodeSchema,
  repoGraphFileNodeSchema,
  repoGraphSymbolNodeBaseSchema,
]);

/**
 * EDGE SCHEMAS
 */

export const repoGraphEdgeEvidenceSchema = z
  .object({
    source: z.enum([
      "project_catalog",
      "code_index_import",
      "code_index_reference",
      "code_index_symbol",
    ]),

    detail: z.string().min(1).optional(),
  })
  .strict();

export const repoGraphEdgeSchema = z
  .object({
    id: z.string().min(1),

    type: z.enum([
      "contains",
      "declares",
      "imports",
      "references",
      "workspace_member",
      "depends_on",
      "development_depends_on",
    ]),

    fromNodeId: z.string().min(1),

    toNodeId: z.string().min(1),

    weight: z.number().int().positive(),

    evidence: z.array(repoGraphEdgeEvidenceSchema),
  })
  .strict();

/**
 * WARNING SCHEMA
 */

export const repoGraphWarningSchema = z
  .object({
    code: z.enum([
      "maximum_files_reached",
      "maximum_edges_reached",
      "code_index_changed_during_build",
      "project_relationship_target_missing",
    ]),

    message: z.string().min(1),

    nodeId: z.string().min(1).optional(),

    path: z.string().min(1).optional(),
  })
  .strict();

/**
 * STATISTICS SCHEMA
 */

export const repoGraphStatisticsSchema = z
  .object({
    availableFiles: z.number().int().nonnegative(),

    indexedFiles: z.number().int().nonnegative(),

    projectNodes: z.number().int().nonnegative(),

    fileNodes: z.number().int().nonnegative(),

    symbolNodes: z.number().int().nonnegative(),

    containsEdges: z.number().int().nonnegative(),

    declaresEdges: z.number().int().nonnegative(),

    importEdges: z.number().int().nonnegative(),

    referenceEdges: z.number().int().nonnegative(),

    projectRelationshipEdges: z.number().int().nonnegative(),

    unresolvedImports: z.number().int().nonnegative(),

    omittedImportTargets: z.number().int().nonnegative(),

    omittedReferenceTargets: z.number().int().nonnegative(),

    consistencyRetries: z.number().int().nonnegative(),

    durationMs: z.number().nonnegative(),
  })
  .strict();

/**
 * COMPLETE GRAPH SCHEMA
 */

export const repoGraphSchema = z
  .object({
    schemaVersion: z.literal(REPO_GRAPH_SCHEMA_VERSION),

    workspaceSnapshotId: z.string().min(1),

    codeIndexChangeToken: z.string().min(1),

    nodes: z.array(repoGraphNodeSchema),

    edges: z.array(repoGraphEdgeSchema),

    warnings: z.array(repoGraphWarningSchema),

    statistics: repoGraphStatisticsSchema,

    status: z.enum(["complete", "partial"]),

    generatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((graph, context) => {
    const nodeIds = new Set<string>();

    const projectIds = new Set<string>();

    for (let index = 0; index < graph.nodes.length; index += 1) {
      const node = graph.nodes[index];

      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["nodes", index, "id"],

          message: `Duplicate graph node ID "${node.id}".`,
        });
      }

      nodeIds.add(node.id);

      if (node.kind === "project") {
        if (projectIds.has(node.projectId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,

            path: ["nodes", index, "projectId"],

            message: `Duplicate project node "${node.projectId}".`,
          });
        }

        projectIds.add(node.projectId);
      }
    }

    const edgeIds = new Set<string>();

    for (let index = 0; index < graph.edges.length; index += 1) {
      const edge = graph.edges[index];

      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["edges", index, "id"],

          message: `Duplicate graph edge ID "${edge.id}".`,
        });
      }

      edgeIds.add(edge.id);

      if (!nodeIds.has(edge.fromNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["edges", index, "fromNodeId"],

          message: "Graph edge references an unknown source node.",
        });
      }

      if (!nodeIds.has(edge.toNodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,

          path: ["edges", index, "toNodeId"],

          message: "Graph edge references an unknown target node.",
        });
      }
    }

    const statistics = graph.statistics;

    const projectNodes = graph.nodes.filter(
      (node) => node.kind === "project",
    ).length;

    const fileNodes = graph.nodes.filter((node) => node.kind === "file").length;

    const symbolNodes = graph.nodes.filter(
      (node) => node.kind === "symbol",
    ).length;

    if (statistics.projectNodes !== projectNodes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "projectNodes"],

        message: "projectNodes does not match the graph node count.",
      });
    }

    if (statistics.fileNodes !== fileNodes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "fileNodes"],

        message: "fileNodes does not match the graph node count.",
      });
    }

    if (statistics.symbolNodes !== symbolNodes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "symbolNodes"],

        message: "symbolNodes does not match the graph node count.",
      });
    }

    if (statistics.indexedFiles !== fileNodes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,

        path: ["statistics", "indexedFiles"],

        message: "indexedFiles must match the number of file nodes.",
      });
    }
  });
