import type { ToolGrant } from "../../decision-policy";
import type { WorkspaceFileSystemPort } from "../contracts";
import type { MutationTransactionRegistry } from "../internal/mutation";
import { MutationError } from "../internal/mutation";
import { applyPatchInputSchema } from "../internal/ToolCatalog";

export async function executeApplyPatch(params: {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  fileSystem: WorkspaceFileSystemPort;
  transactions: MutationTransactionRegistry;
  dirtyPaths?: readonly string[];
  alreadyMutatedPaths?: readonly string[];
}): Promise<{
  output: {
    checkpointId: string;
    changedFiles: string[];
    applied: Array<{
      path: string;
      created: boolean;
      bytesWritten: number;
    }>;
  };
  truncated: boolean;
  redacted: boolean;
}> {
  const parsed = applyPatchInputSchema.parse(params.arguments);

  try {
    const result = await params.transactions.applyPatches({
      workspaceRoot: params.workspaceRoot,
      pathScopes: params.grant.pathScopes,
      fileSystem: params.fileSystem,
      patches: parsed.patches,
      dirtyPaths: params.dirtyPaths,
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });
    return {
      output: result,
      truncated: false,
      redacted: false,
    };
  } catch (error) {
    if (error instanceof MutationError) {
      throw error;
    }
    throw new MutationError(
      "execution_failed",
      `apply_patch failed: ${String(error)}`,
    );
  }
}
