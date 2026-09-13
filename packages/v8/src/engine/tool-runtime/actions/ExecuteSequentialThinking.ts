import {
  getSequentialThinkingEngine,
  type ThoughtData,
} from "../internal/SequentialThinking";
import {
  sequentialThinkingInputSchema,
  sequentialThinkingOutputSchema,
} from "../internal/ToolCatalog";

export async function executeSequentialThinking(params: {
  arguments: unknown;
  workspaceRoot: string;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
}> {
  const input = sequentialThinkingInputSchema.parse(params.arguments);
  const engine = getSequentialThinkingEngine(params.workspaceRoot);
  const thought: ThoughtData = {
    thought: input.thought,
    thoughtNumber: input.thoughtNumber,
    totalThoughts: input.totalThoughts,
    nextThoughtNeeded: Boolean(input.nextThoughtNeeded),
    ...(input.isRevision !== undefined
      ? { isRevision: Boolean(input.isRevision) }
      : {}),
    ...(input.revisesThought !== undefined
      ? { revisesThought: input.revisesThought }
      : {}),
    ...(input.branchFromThought !== undefined
      ? { branchFromThought: input.branchFromThought }
      : {}),
    ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
    ...(input.needsMoreThoughts !== undefined
      ? { needsMoreThoughts: Boolean(input.needsMoreThoughts) }
      : {}),
  };
  const result = engine.processThought(thought);
  return {
    output: sequentialThinkingOutputSchema.parse(result),
    truncated: false,
    redacted: false,
  };
}
