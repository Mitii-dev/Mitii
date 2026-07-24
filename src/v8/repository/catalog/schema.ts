import { z } from "zod";

/**
 * Allows an empty string for a workspace root.
 *
 * Examples:
 * - ""
 * - packages/core
 * - services/api
 */
const canonicalRelativeRootSchema = z.string().refine(
  (value) => {
    if (value === "") {
      return true;
    }

    if (value.startsWith("/") || value.endsWith("/") || value.includes("\\")) {
      return false;
    }

    return !value
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..");
  },
  {
    message: "Expected a canonical workspace-relative project root.",
  },
);

/**
 * Requires a non-empty canonical workspace-relative path.
 *
 * Examples:
 * - package.json
 * - packages/core/src/index.ts
 */
const canonicalRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      if (
        value.startsWith("/") ||
        value.endsWith("/") ||
        value.includes("\\")
      ) {
        return false;
      }

      return !value
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        );
    },
    {
      message: "Expected a canonical workspace-relative path.",
    },
  );

const ecosystemSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    "Expected a valid project ecosystem identifier.",
  );

const stringRecordSchema = z.record(z.string(), z.string());

const uniqueStringArraySchema = z
  .array(z.string().min(1))
  .refine((values) => new Set(values).size === values.length, {
    message: "Array values must be unique.",
  });

const uniquePathArraySchema = z
  .array(canonicalRelativePathSchema)
  .refine((values) => new Set(values).size === values.length, {
    message: "Path values must be unique.",
  });

export const projectDefinitionSchema = z
  .object({
    id: z.string().min(1),

    rootId: z.string().min(1),

    relativeRoot: canonicalRelativeRootSchema,

    name: z.string().min(1),

    version: z.string().min(1).optional(),

    ecosystems: z
      .array(ecosystemSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, {
        message: "Project ecosystems must be unique.",
      }),

    manifests: uniquePathArraySchema,

    entryFiles: uniquePathArraySchema,

    sourceRoots: uniquePathArraySchema,

    testRoots: uniquePathArraySchema,

    scripts: stringRecordSchema,

    dependencies: uniqueStringArraySchema,

    developmentDependencies: uniqueStringArraySchema,
  })
  .strict();

export const projectRelationshipSchema = z
  .object({
    fromProjectId: z.string().min(1),

    toProjectId: z.string().min(1),

    type: z.enum(["workspace_member", "depends_on", "development_depends_on"]),
  })
  .strict();

export const projectCatalogWarningSchema = z
  .object({
    code: z.enum([
      "duplicate_manifest",
      "manifest_path_invalid",
      "unsupported_manifest",
      "manifest_reader_not_found",
      "manifest_reader_ambiguous",
      "manifest_provider_path_missing",
      "manifest_read_failed",
      "manifest_invalid",
      "project_name_missing",
      "duplicate_project_id",
      "nested_project_conflict",
    ]),

    path: z.string(),

    message: z.string().min(1),

    readerId: z.string().min(1).optional(),
  })
  .strict();

export const projectCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),

    workspaceSnapshotId: z
      .string()
      .regex(
        /^[a-f0-9]{64}$/,
        "workspaceSnapshotId must be a SHA-256 hexadecimal value.",
      ),

    projects: z.array(projectDefinitionSchema),

    relationships: z.array(projectRelationshipSchema),

    warnings: z.array(projectCatalogWarningSchema),

    status: z.enum(["complete", "partial"]),

    generatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((catalog, context) => {
    const projectIds = new Set<string>();

    for (let index = 0; index < catalog.projects.length; index += 1) {
      const project = catalog.projects[index];

      if (projectIds.has(project.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projects", index, "id"],
          message: `Duplicate project ID: ` + `"${project.id}".`,
        });
      }

      projectIds.add(project.id);
    }

    const relationshipKeys = new Set<string>();

    for (let index = 0; index < catalog.relationships.length; index += 1) {
      const relationship = catalog.relationships[index];

      if (!projectIds.has(relationship.fromProjectId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationships", index, "fromProjectId"],
          message: "Relationship references an unknown source project.",
        });
      }

      if (!projectIds.has(relationship.toProjectId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationships", index, "toProjectId"],
          message: "Relationship references an unknown target project.",
        });
      }

      if (relationship.fromProjectId === relationship.toProjectId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationships", index],
          message:
            "A project relationship cannot reference the same project as both source and target.",
        });
      }

      const relationshipKey = [
        relationship.fromProjectId,
        relationship.toProjectId,
        relationship.type,
      ].join("\u0000");

      if (relationshipKeys.has(relationshipKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationships", index],
          message: "Duplicate project relationship.",
        });
      }

      relationshipKeys.add(relationshipKey);
    }
  });

export type ProjectCatalogSchemaOutput = z.infer<typeof projectCatalogSchema>;
