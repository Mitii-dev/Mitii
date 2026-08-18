import type { ToolGrant } from "../../../modules/decision-policy";
import type { WorkspaceFileSystemPort } from "../contracts";
import type { MutationTransactionRegistry } from "../internal/mutation";
import { MutationError } from "../internal/mutation";
import { PathContainmentError } from "../internal/PathContainment";
import { deleteFileInputSchema } from "../internal/ToolCatalog";
import { describeCaughtError } from "../internal/describeCaughtError";
import { resolveMutationPathScopes } from "./ResolveMutationPathScopes";

export async function executeDeleteFile(params: {
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
    path: string;
  };
  truncated: boolean;
  redacted: boolean;
}> {
  const parsed = deleteFileInputSchema.parse(params.arguments);

  try {
    const result = await params.transactions.deleteFile({
      workspaceRoot: params.workspaceRoot,
      pathScopes: resolveMutationPathScopes(params.grant),
      fileSystem: params.fileSystem,
      path: parsed.path,
      dirtyPaths: params.dirtyPaths,
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });
    return {
      output: {
        checkpointId: result.checkpointId,
        changedFiles: result.changedFiles,
        path: result.changedFiles[0] ?? parsed.path,
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
      `delete_file failed: ${describeCaughtError(error)}`,
    );
  }
}
