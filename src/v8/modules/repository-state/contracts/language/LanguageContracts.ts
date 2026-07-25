import { z } from "zod";

/**
 * Normalized language IDs accepted by V8 core pipelines.
 * Additional dialects/aliases resolve into one of these IDs.
 */
export const LANGUAGE_IDS = [
  "typescript",
  "javascript",
  "python",
  "java",
  "csharp",
  "go",
  "rust",
  "c",
  "cpp",
  "ruby",
  "php",
  "kotlin",
  "swift",
  "shell",
  "sql",
  "unknown",
] as const;

export const languageIdSchema = z.enum(LANGUAGE_IDS);

export type LanguageId = z.infer<typeof languageIdSchema>;

export const languageCapabilityLevelSchema = z.enum([
  "baseline",
  "enhanced",
  "unavailable",
]);

export type LanguageCapabilityLevel = z.infer<
  typeof languageCapabilityLevelSchema
>;

export const languageProfileSchema = z
  .object({
    id: languageIdSchema,
    displayName: z.string().min(1),
    extensions: z.array(z.string().min(1)),
    filenames: z.array(z.string().min(1)).default([]),
    shebangPatterns: z.array(z.string().min(1)).default([]),
    aliases: z.array(z.string().min(1)).default([]),
    capability: languageCapabilityLevelSchema.default("baseline"),
  })
  .strict();

export type LanguageProfile = z.infer<typeof languageProfileSchema>;

export const languageDetectionEvidenceSchema = z
  .object({
    languageId: languageIdSchema,
    source: z.enum([
      "extension",
      "filename",
      "shebang",
      "explicit",
      "fallback",
    ]),
    evidence: z.string().min(1),
  })
  .strict();

export type LanguageDetectionEvidence = z.infer<
  typeof languageDetectionEvidenceSchema
>;

export const projectDescriptorSchema = z
  .object({
    projectId: z.string().min(1),
    rootPath: z.string().min(1),
    primaryLanguageId: languageIdSchema,
    ecosystemId: z.string().min(1).optional(),
    manifestPaths: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ProjectDescriptor = z.infer<typeof projectDescriptorSchema>;
