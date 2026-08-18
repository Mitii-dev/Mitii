import type { ToolGrant } from "../../../modules/decision-policy";
import type { WorkspaceFileSystemPort } from "../contracts";
import type { MutationTransactionRegistry } from "../internal/mutation";
import { MutationError } from "../internal/mutation";
import { PathContainmentError } from "../internal/PathContainment";
import { deleteDirectoryInputSchema } from "../internal/ToolCatalog";
import { describeCaughtError } from "../internal/describeCaughtError";
import { resolveMutationPathScopes } from "./ResolveMutationPathScopes";

export async function executeDeleteDirectory(params: {
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
    recursive: boolean;
  };
  truncated: boolean;
  redacted: boolean;
}> {
  const parsed = deleteDirectoryInputSchema.parse(params.arguments);
  const recursive = parsed.recursive ?? true;

  try {
    const result = await params.transactions.deleteDirectory({
      workspaceRoot: params.workspaceRoot,
      pathScopes: resolveMutationPathScopes(params.grant),
      fileSystem: params.fileSystem,
      path: parsed.path,
      recursive,
      dirtyPaths: params.dirtyPaths,
      alreadyMutatedPaths: params.alreadyMutatedPaths,
    });
    return {
      output: {
        checkpointId: result.checkpointId,
        changedFiles: result.changedFiles,
        path: parsed.path,
        recursive,
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
      `delete_directory failed: ${describeCaughtError(error)}`,
    );
  }
}
