import { truncateKeepingEnds, updateSectionBudget } from "../actions";
import type { compactConversation, buildSystemInstructions } from "../actions";
import type { allocateBudget } from "../actions";
import type { ModelMessage } from "../../model-gateway";
import type {
  PromptConstructionInput,
  TokenEstimatorPort,
} from "../contracts";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";
import type { PromptAssemblyState } from "./promptAssemblyState";

/** Fits the current user request, builds the message list, and applies last-resort shrink. */
export function assembleUserRequestStage(params: {
  allocation: ReturnType<typeof allocateBudget>;
  attachments: PromptConstructionInput["attachments"];
  state: PromptAssemblyState;
  estimator: TokenEstimatorPort;
  system: ReturnType<typeof buildSystemInstructions>;
  systemContent: string;
  conversationBudget: number;
  conversationResult: ReturnType<typeof compactConversation>;
  rawUserRequest: string;
  repositoryContent: string;
}): { messages: ModelMessage[]; recomputedUsed: number } {
  const {
    allocation,
    state,
    estimator,
    system,
    systemContent,
    conversationBudget,
    conversationResult,
    rawUserRequest,
    repositoryContent,
  } = params;
  const { reasonCodes, warnings, omissions, provenance } = state;
  let sections = state.sections;

  // Reclaim unused history reservation for the current request, then cap to
  // whatever remains in the global input budget after required sections.
  const usedBeforeUser = sections
    .filter((entry) => entry.section !== "output_reserve")
    .reduce((sum, entry) => sum + entry.usedTokens, 0);
  const conversationSlotForUser = Math.max(
    PROMPT_CONSTRUCTION_THRESHOLDS.minimumUserRequestTokens,
    conversationBudget - conversationResult.usedTokens,
  );
  const globalSlotForUser = Math.max(
    PROMPT_CONSTRUCTION_THRESHOLDS.minimumUserRequestTokens,
    allocation.inputBudgetTokens -
      usedBeforeUser -
      conversationResult.usedTokens,
  );
  const userRequestBudget = Math.min(
    conversationSlotForUser,
    globalSlotForUser,
  );
  const truncatedUser = truncateKeepingEnds(
    rawUserRequest,
    userRequestBudget,
    estimator,
  );
  const userRequest = truncatedUser.content;
  const userRequestTokens = truncatedUser.usedTokens;
  if (truncatedUser.truncatedTokens > 0) {
    reasonCodes.push("user_request_truncated");
    omissions.push({
      section: "conversation",
      reason: "budget",
      detail:
        "Current user request truncated to fit the input budget (large paste).",
      tokens: truncatedUser.truncatedTokens,
      source: "user_request",
    });
    warnings.push(
      "Current user request was truncated to fit the prompt input budget; the beginning and end were retained.",
    );
  }

  provenance.push({
    blockId: "user:request",
    section: "conversation",
    source: "user_request",
    trust: "trusted_instruction",
  });

  sections = updateSectionBudget(sections, "conversation", {
    usedTokens: conversationResult.usedTokens + userRequestTokens,
    omittedTokens:
      conversationResult.omittedTokens +
      (truncatedUser.truncatedTokens > 0 ? truncatedUser.truncatedTokens : 0),
    truncatedTokens:
      conversationResult.truncatedTokens + truncatedUser.truncatedTokens,
  });

  const userContent = [repositoryContent, userRequest]
    .filter((part) => part.length > 0)
    .join("\n\n");

  const userAttachments = params.attachments?.map((attachment) => ({
    kind: "image" as const,
    ...attachment,
  }));

  const messages: ModelMessage[] = [
    { role: "system", content: systemContent },
    ...system.separateMessages.map((message) => ({
      role: message.role as ModelMessage["role"],
      content: message.content,
    })),
    ...conversationResult.messages,
    {
      role: "user",
      content: userContent,
      ...(userAttachments && userAttachments.length > 0
        ? { attachments: userAttachments }
        : {}),
    },
  ];

  let recomputedUsed = sections
    .filter((entry) => entry.section !== "output_reserve")
    .reduce((sum, entry) => sum + entry.usedTokens, 0);

  // Last-resort fit: shrink the current user request further rather than
  // blocking the run when a large paste still overflows.
  if (
    recomputedUsed > allocation.inputBudgetTokens &&
    userRequestTokens > PROMPT_CONSTRUCTION_THRESHOLDS.minimumUserRequestTokens
  ) {
    const overflow = recomputedUsed - allocation.inputBudgetTokens;
    const emergencyBudget = Math.max(
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumUserRequestTokens,
      userRequestTokens - overflow,
    );
    const emergency = truncateKeepingEnds(
      rawUserRequest,
      emergencyBudget,
      estimator,
    );
    if (emergency.usedTokens < userRequestTokens) {
      const fittedUserContent = [repositoryContent, emergency.content]
        .filter((part) => part.length > 0)
        .join("\n\n");
      messages[messages.length - 1] = {
        role: "user",
        content: fittedUserContent,
        ...(userAttachments && userAttachments.length > 0
          ? { attachments: userAttachments }
          : {}),
      };
      const reclaimed = userRequestTokens - emergency.usedTokens;
      sections = updateSectionBudget(sections, "conversation", {
        usedTokens: conversationResult.usedTokens + emergency.usedTokens,
        omittedTokens:
          conversationResult.omittedTokens + emergency.truncatedTokens,
        truncatedTokens:
          conversationResult.truncatedTokens + emergency.truncatedTokens,
      });
      recomputedUsed = Math.max(0, recomputedUsed - reclaimed);
      if (!reasonCodes.includes("user_request_truncated")) {
        reasonCodes.push("user_request_truncated");
      }
      if (
        !omissions.some(
          (item) =>
            item.section === "conversation" && item.source === "user_request",
        )
      ) {
        omissions.push({
          section: "conversation",
          reason: "budget",
          detail:
            "Current user request truncated to fit the input budget (large paste).",
          tokens: emergency.truncatedTokens,
          source: "user_request",
        });
      }
      warnings.push(
        "Current user request was further truncated so prompt construction could stay within the input budget.",
      );
    }
  }

  state.sections = sections;
  return { messages, recomputedUsed };
}
