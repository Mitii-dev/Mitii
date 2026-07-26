import type { TokenEstimatorPort } from "../contracts";
import type { PromptRepositoryBlock, PromptRepositoryContext } from "../contracts";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";
import {
  countInjectionSignals,
  wrapUntrustedFileBlock,
  wrapUntrustedRepositoryContent,
} from "../internal/InjectionBoundary";
import { truncateToTokenBudget } from "./BuildSystemAndConversation";

export interface SerializedRepositoryContext {
  content: string;
  usedTokens: number;
  omittedTokens: number;
  truncatedTokens: number;
  includedBlockIds: string[];
  provenance: Array<{
    blockId: string;
    source: string;
  }>;
  omissions: Array<{
    source: string;
    tokens: number;
    detail: string;
  }>;
  injectionSignals: number;
}

export function serializeRepositoryContext(params: {
  repositoryContext: PromptRepositoryContext;
  estimator: TokenEstimatorPort;
  budgetTokens: number;
}): SerializedRepositoryContext {
  const sorted = [...params.repositoryContext.blocks]
    .sort((a, b) => {
      const scoreDelta = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return b.priority - a.priority;
    })
    .slice(0, PROMPT_CONSTRUCTION_THRESHOLDS.maximumRepositoryBlocks);

  const seenContent = new Set<string>();
  const fileBodies: string[] = [];
  const includedBlockIds: string[] = [];
  const provenance: SerializedRepositoryContext["provenance"] = [];
  const omissions: SerializedRepositoryContext["omissions"] = [];
  let usedTokens = 0;
  let omittedTokens = 0;
  let truncatedTokens = 0;
  let remaining = params.budgetTokens;
  let injectionSignals = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const block = sorted[index]!;
    const dedupeKey = `${block.relativePath}::${block.content}`;
    if (seenContent.has(dedupeKey)) {
      const tokens = estimateBlock(block, params.estimator);
      omissions.push({
        source: block.relativePath,
        tokens,
        detail: "duplicate_block",
      });
      omittedTokens += tokens;
      continue;
    }
    seenContent.add(dedupeKey);

    injectionSignals += countInjectionSignals(block.content);

    const fileBody = wrapUntrustedFileBlock({
      id: block.id,
      relativePath: block.relativePath,
      content: block.content,
      selectionKey: block.selectionKey,
      priority: block.priority,
      lineRanges: block.lineRanges,
    });
    const tokens = params.estimator.estimate(fileBody);

    if (tokens <= remaining) {
      fileBodies.push(fileBody);
      includedBlockIds.push(block.id);
      provenance.push({ blockId: block.id, source: block.relativePath });
      usedTokens += tokens;
      remaining -= tokens;
      if (block.truncated || block.omittedCharacters > 0) {
        truncatedTokens += Math.ceil(block.omittedCharacters / 4);
      }
      continue;
    }

    if (remaining > 48) {
      const truncated = truncateToTokenBudget(
        fileBody,
        remaining,
        params.estimator,
      );
      if (truncated.content.length > 0) {
        fileBodies.push(truncated.content);
        includedBlockIds.push(block.id);
        provenance.push({ blockId: block.id, source: block.relativePath });
        usedTokens += truncated.usedTokens;
        truncatedTokens += truncated.truncatedTokens;
        remaining -= truncated.usedTokens;
      } else {
        omissions.push({
          source: block.relativePath,
          tokens,
          detail: "budget",
        });
        omittedTokens += tokens;
      }
      for (const skipped of sorted.slice(index + 1)) {
        const skippedTokens = estimateBlock(skipped, params.estimator);
        omissions.push({
          source: skipped.relativePath,
          tokens: skippedTokens,
          detail: "budget",
        });
        omittedTokens += skippedTokens;
      }
      break;
    }

    omissions.push({
      source: block.relativePath,
      tokens,
      detail: "budget",
    });
    omittedTokens += tokens;
  }

  for (const dropped of params.repositoryContext.dropped ?? []) {
    omissions.push({
      source: dropped.relativePath,
      tokens: 0,
      detail: dropped.cause,
    });
  }

  const wrapped =
    fileBodies.length === 0
      ? ""
      : wrapUntrustedRepositoryContent({
          stateToken: params.repositoryContext.stateToken,
          body: fileBodies.join("\n\n"),
        });

  const wrapExtra =
    wrapped.length === 0
      ? 0
      : Math.max(
          0,
          params.estimator.estimate(wrapped) -
            fileBodies.reduce(
              (sum, body) => sum + params.estimator.estimate(body),
              0,
            ),
        );

  return {
    content: wrapped,
    usedTokens: wrapped.length === 0 ? 0 : usedTokens + wrapExtra,
    omittedTokens,
    truncatedTokens,
    includedBlockIds,
    provenance,
    omissions,
    injectionSignals,
  };
}

function estimateBlock(
  block: PromptRepositoryBlock,
  estimator: TokenEstimatorPort,
): number {
  return (
    block.tokenEstimate ??
    estimator.estimate(block.content)
  );
}
