import type { ToolGrant } from "../../../modules/decision-policy";
import type { WorkspaceFileSystemPort } from "../contracts";
import type { MutationTransactionRegistry } from "../internal/mutation";
import { MutationError } from "../internal/mutation";
import { PathContainmentError } from "../internal/PathContainment";
import { applyPatchInputSchema } from "../internal/ToolCatalog";
import { describeCaughtError } from "../internal/describeCaughtError";
import { resolveMutationPathScopes } from "./ResolveMutationPathScopes";

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
      pathScopes: resolveMutationPathScopes(params.grant),
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
    if (
      error instanceof MutationError ||
      error instanceof PathContainmentError
    ) {
      throw error;
    }
    throw new MutationError(
      "execution_failed",
      `apply_patch failed: ${describeCaughtError(error)}`,
    );
  }
}
