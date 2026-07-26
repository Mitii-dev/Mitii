import type { PromptRepositoryContext } from "../../prompt-construction";
import type { RepositoryContextPipelineResult } from "../../repository-context";

/**
 * Map repository-context assembly output to the prompt-facing slice.
 * Never forwards retrieval/index internals.
 */
export function mapContextToPromptSlice(
  context: RepositoryContextPipelineResult,
): PromptRepositoryContext {
  return {
    stateToken: context.stateToken,
    blocks: context.assembly.blocks.map((block) => ({
      id: block.id,
      relativePath: block.relativePath,
      content: block.content,
      tokenEstimate: block.tokenEstimate,
      truncated: block.truncated,
      omittedCharacters: block.omittedCharacters ?? 0,
      priority: 100,
      ...(block.lineRanges && block.lineRanges.length > 0
        ? {
            lineRanges: block.lineRanges.map((range) => ({
              startLine: range.startLine,
              endLine: range.endLine,
            })),
          }
        : {}),
    })),
    ...(context.assembly.dropped && context.assembly.dropped.length > 0
      ? {
          dropped: context.assembly.dropped.map((entry) => ({
            relativePath: entry.relativePath,
            cause: entry.cause,
          })),
        }
      : {}),
  };
}
