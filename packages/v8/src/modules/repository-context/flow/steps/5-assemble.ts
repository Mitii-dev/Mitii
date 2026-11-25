import type {
  RepositoryContextAssemblerPort,
  RepositoryContextPipelineInput,
  RepositoryContextResolvedState,
} from "../../contracts/types";
import type { ContextAssemblyResult } from "../../helpers/context-assembly/types";
import type { ContextSelectionResult } from "../../helpers/context-selection/types";

export async function assembleRepositoryContext(params: {
  input: RepositoryContextPipelineInput;
  artifacts: RepositoryContextResolvedState;
  selection: ContextSelectionResult;
  assembler: RepositoryContextAssemblerPort;
}): Promise<ContextAssemblyResult> {
  const { input, artifacts, selection, assembler } = params;
  return assembler.assemble({
    selection,
    snapshot: artifacts.snapshot,
    ...(input.folderPrefix ? { folderPrefix: input.folderPrefix } : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
