import { z } from "zod";

import {
  REPO_GRAPH_SCHEMA_VERSION,
} from "./constants";

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
        .some(
          (segment) =>
            !segment ||
            segment === "." ||
            segment === "..",
        ),
    {
      message:
        "Expected a canonical workspace-relative path.",
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
          .some(
            (segment) =>
              !segment ||
              segment === "." ||
              segment === "..",
          )),
    {
      message:
        "Expected a canonical workspace-relative project root.",
    },
  );

const uniqueNonEmptyStringArraySchema = z
  .array(z.string().min(1))
  .min(1)
  .refine(
    (values) =>
      new Set(values).size === values.length,
    {
      message: "Values must be unique.",
    },
  );

export const repoGraphProjectNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("project"),
    projectId: z.string().min(1),
    rootId: z.string().min(1),
    relativeRoot:
      canonicalRelativeRootSchema,
    name: z.string().min(1),
    ecosystems:
      uniqueNonEmptyStringArraySchema,
  })
  .strict();

export const repoGraphFileNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("file"),
    fileId: z.string().min(1),
    rootId: z.string().min(1),
    relativePath:
      canonicalRelativePathSchema,
    projectId:
      z.string().min(1).optional(),
    language:
      z.string().min(1).optional(),
    size:
      z.number().nonnegative().optional(),
    modifiedAt:
      z.string().datetime().optional(),
    contentHash:
      z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (node) => node.id === node.fileId,
    {
      path: ["fileId"],
      message:
        "File graph node ID must equal fileId.",
    },
  );

export const repoGraphSymbolNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("symbol"),
    symbolId: z.string().min(1),
    fileId: z.string().min(1),
    parentSymbolId:
      z.string().min(1).optional(),
    name: z.string().min(1),
    symbolKind: z.string().min(1),
    exported: z.boolean().optional(),
    signature:
      z.string().min(1).optional(),
    startLine:
      z.number().int().positive().optional(),
    endLine:
      z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.id !== node.symbolId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["symbolId"],
        message:
          "Symbol graph node ID must equal symbolId.",
      });
    }

    if (
      node.startLine !== undefined &&
      node.endLine !== undefined &&
      node.endLine < node.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message:
          "endLine must be greater than or equal to startLine.",
      });
    }
  });

export const repoGraphNodeSchema =
  z.union([
    repoGraphProjectNodeSchema,
    repoGraphFileNodeSchema,
    repoGraphSymbolNodeSchema,
  ]);

export const repoGraphEdgeEvidenceSchema = z
  .object({
    source: z.enum([
      "project_catalog",
      "code_index_import",
      "code_index_reference",
      "code_index_symbol",
    ]),
    detail:
      z.string().min(1).optional(),
    line:
      z.number().int().positive().optional(),
  })
  .strict();

export const repoGraphEdgeSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "contains",
      "declares",
      "imports",
      "calls",
      "references",
      "workspace_member",
      "depends_on",
      "development_depends_on",
    ]),
    fromNodeId:
      z.string().min(1),
    toNodeId:
      z.string().min(1),
    weight:
      z.number().int().positive(),
    evidenceCount:
      z.number().int().positive(),
    evidence:
      z.array(
        repoGraphEdgeEvidenceSchema,
      ),
    evidenceTruncated:
      z.boolean(),
  })
  .strict()
  .superRefine((edge, context) => {
    if (
      edge.evidenceCount <
      edge.evidence.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceCount"],
        message:
          "evidenceCount cannot be smaller than evidence.length.",
      });
    }

    const expectedTruncated =
      edge.evidenceCount >
      edge.evidence.length;

    if (
      edge.evidenceTruncated !==
      expectedTruncated
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceTruncated"],
        message:
          "evidenceTruncated must indicate whether evidence instances were omitted.",
      });
    }
  });

export const repoGraphWarningSchema = z
  .object({
    code: z.enum([
      "maximum_files_reached",
      "maximum_nodes_reached",
      "maximum_symbol_nodes_reached",
      "maximum_edges_reached",
      "symbols_truncated",
      "code_index_changed_during_build",
      "project_relationship_target_missing",
    ]),
    message: z.string().min(1),
    nodeId:
      z.string().min(1).optional(),
    path:
      z.string().min(1).optional(),
  })
  .strict();

export const repoGraphStatisticsSchema = z
  .object({
    availableFiles:
      z.number().int().nonnegative(),
    indexedFiles:
      z.number().int().nonnegative(),
    projectNodes:
      z.number().int().nonnegative(),
    fileNodes:
      z.number().int().nonnegative(),
    symbolNodes:
      z.number().int().nonnegative(),
    containsEdges:
      z.number().int().nonnegative(),
    declaresEdges:
      z.number().int().nonnegative(),
    importEdges:
      z.number().int().nonnegative(),
    callEdges:
      z.number().int().nonnegative(),
    referenceEdges:
      z.number().int().nonnegative(),
    projectRelationshipEdges:
      z.number().int().nonnegative(),
    unresolvedImports:
      z.number().int().nonnegative(),
    omittedImportTargets:
      z.number().int().nonnegative(),
    ambiguousReferences:
      z.number().int().nonnegative(),
    unresolvedReferences:
      z.number().int().nonnegative(),
    omittedReferenceTargets:
      z.number().int().nonnegative(),
    omittedParentSymbolTargets:
      z.number().int().nonnegative(),
    truncatedSymbolFiles:
      z.number().int().nonnegative(),
    droppedSymbolNodes:
      z.number().int().nonnegative(),
    droppedEdges:
      z.number().int().nonnegative(),
    consistencyRetries:
      z.number().int().nonnegative(),
    durationMs:
      z.number().nonnegative(),
  })
  .strict();

export const repoGraphSchema = z
  .object({
    schemaVersion:
      z.literal(
        REPO_GRAPH_SCHEMA_VERSION,
      ),
    workspaceSnapshotId:
      z.string().min(1),
    codeIndexChangeToken:
      z.string().min(1),
    nodes:
      z.array(repoGraphNodeSchema),
    edges:
      z.array(repoGraphEdgeSchema),
    warnings:
      z.array(repoGraphWarningSchema),
    statistics:
      repoGraphStatisticsSchema,
    status:
      z.enum([
        "complete",
        "partial",
      ]),
    generatedAt:
      z.string().datetime(),
  })
  .strict()
  .superRefine((graph, context) => {
    const nodeIds =
      new Set<string>();

    for (
      const [
        index,
        node,
      ] of graph.nodes.entries()
    ) {

      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "nodes",
            index,
            "id",
          ],
          message:
            `Duplicate graph node ID "${node.id}".`,
        });
      }

      nodeIds.add(node.id);
    }

    const edgeIds =
      new Set<string>();

    for (
      const [
        index,
        edge,
      ] of graph.edges.entries()
    ) {

      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "edges",
            index,
            "id",
          ],
          message:
            `Duplicate graph edge ID "${edge.id}".`,
        });
      }

      edgeIds.add(edge.id);

      if (
        !nodeIds.has(edge.fromNodeId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "edges",
            index,
            "fromNodeId",
          ],
          message:
            "Graph edge references an unknown source node.",
        });
      }

      if (
        !nodeIds.has(edge.toNodeId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "edges",
            index,
            "toNodeId",
          ],
          message:
            "Graph edge references an unknown target node.",
        });
      }
    }

    const nodeCounts = {
      projectNodes:
        graph.nodes.filter(
          (node) =>
            node.kind === "project",
        ).length,

      fileNodes:
        graph.nodes.filter(
          (node) =>
            node.kind === "file",
        ).length,

      symbolNodes:
        graph.nodes.filter(
          (node) =>
            node.kind === "symbol",
        ).length,
    };

    const edgeCounts = {
      containsEdges:
        graph.edges.filter(
          (edge) =>
            edge.type === "contains",
        ).length,

      declaresEdges:
        graph.edges.filter(
          (edge) =>
            edge.type === "declares",
        ).length,

      importEdges:
        graph.edges.filter(
          (edge) =>
            edge.type === "imports",
        ).length,

      callEdges:
        graph.edges.filter(
          (edge) =>
            edge.type === "calls",
        ).length,

      referenceEdges:
        graph.edges.filter(
          (edge) =>
            edge.type === "references",
        ).length,

      projectRelationshipEdges:
        graph.edges.filter(
          (edge) =>
            edge.type ===
              "workspace_member" ||
            edge.type ===
              "depends_on" ||
            edge.type ===
              "development_depends_on",
        ).length,
    };

    for (
      const [
        key,
        actual,
      ] of Object.entries({
        ...nodeCounts,
        ...edgeCounts,
      })
    ) {
      const expected =
        graph.statistics[
          key as keyof typeof graph.statistics
        ];

      if (expected !== actual) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "statistics",
            key,
          ],
          message:
            `${key} does not match the graph contents.`,
        });
      }
    }

    if (
      graph.statistics.indexedFiles !==
      nodeCounts.fileNodes
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "statistics",
          "indexedFiles",
        ],
        message:
          "indexedFiles must equal the file-node count.",
      });
    }
  });
