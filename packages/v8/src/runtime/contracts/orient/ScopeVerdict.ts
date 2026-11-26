import { z } from "zod";

/**
 * Focus ≠ fence (§4.3). Mentions / selection → focus only.
 * mutationFence only when user/prose/safety explicitly limits edits.
 */
export const scopeVerdictEvidenceSchema = z.enum([
  "focus_only",
  "explicit_limit",
  "safety_rule",
  "unclear",
]);

export const scopeReadHintSchema = z.enum([
  "workspace",
  "package",
  "folder",
]);

export const scopeVerdictSchema = z
  .object({
    /** Paths/folders/symbols to look at first (mentions, selection, dirty). */
    focusPaths: z.array(z.string()).default([]),
    /** Owning project/package from catalog when known (monorepo-aware). */
    workRoot: z.string().optional(),
    /** Advisory read breadth — never a hard filter by itself. */
    readHint: scopeReadHintSchema.default("workspace"),
    /** Set ONLY for explicit edit limits / safety. Folder mention alone ≠ fence. */
    mutationFence: z.array(z.string()).optional(),
    /**
     * Paths that still need approval / hard caution (S2-SCOPE).
     * Precedence: protectedPaths > writePaths > readPaths.
     */
    protectedPaths: z.array(z.string()).optional(),
    evidence: scopeVerdictEvidenceSchema.default("focus_only"),
    /** Optional dependents/importers from change-impact (awareness, not fence). */
    relatedSeeds: z.array(z.string()).default([]),
  })
  .strict();

export type ScopeVerdict = z.infer<typeof scopeVerdictSchema>;
export type ScopeVerdictEvidence = z.infer<typeof scopeVerdictEvidenceSchema>;
export type ScopeReadHint = z.infer<typeof scopeReadHintSchema>;
