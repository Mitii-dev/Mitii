import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  applyPatchInputSchema,
  applyPatchOutputSchema,
  defineTool,
} from "../../internal/ToolCatalog";
import { MutationError } from "../../internal/mutation";
import type { DiagnosticItem } from "../../contracts";
import { executeApplyPatch } from "../ExecuteApplyPatch";
import { filterNewDiagnostics } from "../filterNewDiagnostics";

export const applyPatchTool: RegisteredTool = {
  definition: defineTool({
    name: "apply_patch",
    effects: ["workspace_write"],
    description:
      "Apply structured oldText/newText patches inside a recoverable transaction. Arguments MUST be `{ \"patches\": [ { \"path\", \"oldText\", \"newText\" } ] }` — `patches` is a JSON array (not a string). Do not send a flat `{ path, oldText, newText }` object. Default is exact unique oldText match (no regex). Set replaceAll=true to replace every exact occurrence in that file. Set fuzzyMatch=true for bounded recovery when exact oldText is missing (trim / indent / ±5 line window); ambiguous fuzzy hits return patch_fuzzy_ambiguous. Batch to the mutation budget on this grant (preferredBatchSize / maxUniqueFilesPerCall; catalog max 20 unique files). Use minimal hunks — never rewrite many whole files in one response; continue across turns for large refactors. Create new files with oldText=\"\". Distinct rejections: old_text_not_found, old_text_ambiguous, patch_fuzzy_ambiguous, patch_target_missing, patch_hash_mismatch, identical_old_and_new, patch_syntax_invalid. For deletes use delete_file/delete_directory; for renames/moves use move_file.",
    inputSchema: applyPatchInputSchema,
    outputSchema: applyPatchOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              oldText: { type: "string" },
              newText: { type: "string" },
              expectedHash: { type: "string" },
              replaceAll: { type: "boolean" },
              fuzzyMatch: { type: "boolean" },
            },
            required: ["path", "oldText", "newText"],
          },
          minItems: 1,
          maxItems: 12,
        },
      },
      required: ["patches"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    if (!ctx.transactions) {
      throw new MutationError(
        "execution_failed",
        "Mutation transaction registry is not configured.",
      );
    }

    const parsed = applyPatchInputSchema.parse(ctx.arguments);
    // Creates use oldText "". Baseline diagnostics on those paths throw in the
    // host TS service ("Could not find source file") and used to abort the
    // write before executeApplyPatch ran — skip creates for baseline.
    const existingPaths = [
      ...new Set(
        parsed.patches
          .filter((patch) => patch.oldText !== "")
          .map((patch) => patch.path),
      ),
    ];
    const diagnosticsPort = ctx.ports.diagnostics;
    const baseline =
      diagnosticsPort !== undefined && existingPaths.length > 0
        ? await safeReadDiagnostics(diagnosticsPort, {
            workspaceRoot: ctx.workspaceRoot,
            paths: existingPaths,
          })
        : [];

    const result = await executeApplyPatch({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      transactions: ctx.transactions,
      dirtyPaths: ctx.dirtyPaths,
      alreadyMutatedPaths: ctx.alreadyMutatedPaths,
    });

    if (!diagnosticsPort) {
      return result;
    }

    const after = await safeReadDiagnostics(diagnosticsPort, {
      workspaceRoot: ctx.workspaceRoot,
      paths: result.output.changedFiles,
    });
    const newDiagnostics = filterNewDiagnostics({ after, baseline });
    if (newDiagnostics.length === 0) {
      return result;
    }

    return {
      ...result,
      output: {
        ...result.output,
        newDiagnostics,
      },
    };
  },
};

async function safeReadDiagnostics(
  port: {
    readDiagnostics(params: {
      workspaceRoot: string;
      paths?: readonly string[];
    }): Promise<readonly DiagnosticItem[]>;
  },
  params: { workspaceRoot: string; paths: readonly string[] },
): Promise<DiagnosticItem[]> {
  try {
    return [...(await port.readDiagnostics(params))];
  } catch {
    // Never fail a successful mutation because diagnostics blew up.
    return [];
  }
}
