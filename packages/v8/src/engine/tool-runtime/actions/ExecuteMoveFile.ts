import type { ToolGrant } from "../../../modules/decision-policy";
import type { WorkspaceFileSystemPort } from "../contracts";
import type { MutationTransactionRegistry } from "../internal/mutation";
import { MutationError } from "../internal/mutation";
import { PathContainmentError } from "../internal/PathContainment";
import { moveFileInputSchema } from "../internal/ToolCatalog";

export async function executeMoveFile(params: {
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
    from: string;
    to: string;
  };
  truncated: boolean;
  redacted: boolean;
}> {
  const parsed = moveFileInputSchema.parse(params.arguments);

  try {
    const result = await params.transactions.moveFile({
      workspaceRoot: params.workspaceRoot,
      pathScopes: params.grant.pathScopes,
      fileSystem: params.fileSystem,
      from: parsed.from,
      to: parsed.to,
      dirtyPaths: params.dirtyPaths,
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });
    return {
      output: {
        checkpointId: result.checkpointId,
        changedFiles: result.changedFiles,
        from: parsed.from,
        to: parsed.to,
      },
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
      `move_file failed: ${String(error)}`,
    );
  }
}
