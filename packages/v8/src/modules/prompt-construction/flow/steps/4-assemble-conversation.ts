import {
  compactConversation,
  serializeRepositoryContext,
  updateSectionBudget,
} from "../../helpers";
import type {
  PromptConstructionInput,
  TokenEstimatorPort,
} from "../../contracts";
import { DEFAULT_MIN_CONVERSATION_TURNS } from "../../defaults";
import { wrapUserRequest } from "../../helpers/InjectionBoundary";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../../rules";
import {
  sectionAllocation,
  type PromptAssemblyState,
} from "../../helpers/promptAssemblyState";

type CompactedConversation = ReturnType<typeof compactConversation>;

/** Compacts history within the conversation budget and wraps the current request. */
export function assembleConversationStage(params: {
  parsed: PromptConstructionInput;
  state: PromptAssemblyState;
  estimator: TokenEstimatorPort;
}): {
  conversationBudget: number;
  rawUserRequest: string;
  conversationResult: CompactedConversation;
} {
  const { parsed, state, estimator } = params;
  const { reasonCodes, omissions, provenance } = state;
  const sectionAlloc = (
    name: (typeof state.sections)[number]["section"],
  ): number => sectionAllocation(state.sections, name);

  const conversationBudget = sectionAlloc("conversation");
  const rawUserRequest = wrapUserRequest(parsed.userMessage);
  const rawUserRequestTokens = estimator.estimate(rawUserRequest);
  const reservedUserTokens = Math.min(
    rawUserRequestTokens,
    Math.max(
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumUserRequestTokens,
      Math.floor(
        conversationBudget *
          PROMPT_CONSTRUCTION_THRESHOLDS.userRequestConversationShare,
      ),
    ),
  );
  const historyBudget = Math.max(0, conversationBudget - reservedUserTokens);

  const conversationResult = compactConversation({
    messages: parsed.conversation,
    estimator: estimator,
    budgetTokens: historyBudget,
    minTurns: DEFAULT_MIN_CONVERSATION_TURNS,
  });
  if (conversationResult.compacted) {
    reasonCodes.push("conversation_compacted");
  }
  if (conversationResult.omittedTokens > 0) {
    omissions.push({
      section: "conversation",
      reason: "budget",
      detail: "Older conversation turns compacted or dropped to fit budget.",
      tokens: conversationResult.omittedTokens,
    });
  }
  for (const [index, message] of conversationResult.messages.entries()) {
    provenance.push({
      blockId: `conversation:${index}`,
      section: "conversation",
      source: `${message.role}:${index}`,
      trust:
        message.role === "tool" ? "untrusted_tool_content" : "conversation",
    });
  }

  return { conversationBudget, rawUserRequest, conversationResult };
}

/** Serializes untrusted repository context (or records why it was skipped). */
export function assembleRepositoryStage(params: {
  parsed: PromptConstructionInput;
  state: PromptAssemblyState;
  estimator: TokenEstimatorPort;
}): { repositoryContent: string } {
  const { parsed, state, estimator } = params;
  const { reasonCodes, warnings, omissions, provenance } = state;
  let sections = state.sections;
  const sectionAlloc = (
    name: (typeof sections)[number]["section"],
  ): number => sectionAllocation(sections, name);

  let repositoryContent = "";
  if (!parsed.decision.repositoryContextRequired) {
    reasonCodes.push("repository_not_required");
    if (
      parsed.repositoryContext &&
      parsed.repositoryContext.blocks.length > 0
    ) {
      const omittedTokens = parsed.repositoryContext.blocks.reduce(
        (sum, block) =>
          sum +
          (block.tokenEstimate ?? estimator.estimate(block.content)),
        0,
      );
      omissions.push({
        section: "repository",
        reason: "not_required",
        detail:
          "Repository context supplied but decision does not require repository grounding.",
        tokens: omittedTokens,
      });
      sections = updateSectionBudget(sections, "repository", {
        usedTokens: 0,
        omittedTokens,
      });
    }
  } else if (
    !parsed.repositoryContext ||
    parsed.repositoryContext.blocks.length === 0
  ) {
    omissions.push({
      section: "repository",
      reason: "empty",
      detail: "Repository context required but no blocks were supplied.",
    });
    warnings.push(
      "Repository context was required by the decision but no blocks were provided.",
    );
  } else {
    const repository = serializeRepositoryContext({
      repositoryContext: parsed.repositoryContext,
      estimator: estimator,
      budgetTokens: sectionAlloc("repository"),
    });
    repositoryContent = repository.content;
    reasonCodes.push("repository_wrapped_untrusted");
    if (repository.injectionSignals > 0) {
      warnings.push(
        `Detected ${repository.injectionSignals} injection-like pattern(s) in repository content; treated as untrusted evidence only.`,
      );
    }
    for (const entry of repository.provenance) {
      provenance.push({
        blockId: entry.blockId,
        section: "repository",
        source: entry.source,
        trust: "untrusted_repository_content",
      });
    }
    for (const omission of repository.omissions) {
      omissions.push({
        section: "repository",
        reason:
          omission.detail === "duplicate_block" ? "duplicate" : "budget",
        detail: `Repository block ${omission.source} omitted (${omission.detail})`,
        tokens: omission.tokens,
        source: omission.source,
      });
    }
    sections = updateSectionBudget(sections, "repository", {
      usedTokens: repository.usedTokens,
      omittedTokens: repository.omittedTokens,
      truncatedTokens: repository.truncatedTokens,
    });
    if (repository.omittedTokens > 0 || repository.truncatedTokens > 0) {
      reasonCodes.push("partial_context_omitted");
    }
  }

  state.sections = sections;
  return { repositoryContent };
}
