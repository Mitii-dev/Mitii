import type { ModelMessage, ModelRequest } from "../../model-gateway";

import {
  allocateBudget,
  buildSystemInstructions,
  compactConversation,
  resolveDynamicOutputTokens,
  serializeRepositoryContext,
  serializeTools,
  truncateKeepingEnds,
  updateSectionBudget,
} from "../actions";
import { CharacterTokenEstimator } from "../internal/CharacterTokenEstimator";
import { PROMPT_CONSTRUCTION_SCHEMA_VERSION } from "../constants";
import {
  PromptConstructionError,
  promptConstructionInputSchema,
  promptConstructionResultSchema,
} from "../contracts";
import type {
  PromptConstructionInput,
  PromptConstructionResult,
  PromptOmission,
  PromptProvenanceEntry,
  PromptReasonCode,
  TokenEstimatorPort,
} from "../contracts";
import { DEFAULT_MIN_CONVERSATION_TURNS } from "../defaults";
import { wrapUserRequest } from "../internal/InjectionBoundary";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";

export interface PromptConstructionPipelineOptions {
  tokenEstimator?: TokenEstimatorPort;
}

export class PromptConstructionPipeline {
  private readonly estimator: TokenEstimatorPort;

  constructor(options: PromptConstructionPipelineOptions = {}) {
    this.estimator = options.tokenEstimator ?? new CharacterTokenEstimator();
  }

  public construct(input: PromptConstructionInput): PromptConstructionResult {
    let parsed: PromptConstructionInput;
    try {
      parsed = promptConstructionInputSchema.parse(input);
    } catch (error) {
      throw new PromptConstructionError(
        "invalid_input",
        "Prompt Construction input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const allocation = allocateBudget({
      capabilities: parsed.capabilities,
      outputReserveTokens: parsed.outputReserveTokens,
    });

    if (
      allocation.inputBudgetTokens <
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumSystemTokens
    ) {
      throw new PromptConstructionError(
        "budget_impossible",
        "Provider context window cannot reserve output and still fit required system instructions.",
        {
          contextWindowTokens: allocation.contextWindowTokens,
          outputReservedTokens: allocation.outputReservedTokens,
          inputBudgetTokens: allocation.inputBudgetTokens,
        },
      );
    }

    const reasonCodes: PromptReasonCode[] = ["output_reserved_first"];
    const warnings: string[] = [];
    const omissions: PromptOmission[] = [];
    const provenance: PromptProvenanceEntry[] = [];
    let sections = allocation.sections;

    const sectionAlloc = (name: (typeof sections)[number]["section"]): number =>
      sections.find((entry) => entry.section === name)?.allocatedTokens ?? 0;

    const systemBudget =
      sectionAlloc("system") +
      sectionAlloc("rules") +
      sectionAlloc("skills") +
      sectionAlloc("memory");

    const system = buildSystemInstructions({
      decision: parsed.decision,
      projectRules: parsed.instructions?.projectRules ?? [],
      skills: parsed.instructions?.skills ?? [],
      memory: parsed.instructions?.memory ?? [],
      estimator: this.estimator,
      budgetTokens: systemBudget,
      planText: parsed.planText,
    });
    let systemContent = system.content;

    provenance.push({
      blockId: "system:core",
      section: "system",
      source: "system:safety+route",
      trust: "trusted_instruction",
    });
    for (const id of system.includedRuleIds) {
      provenance.push({
        blockId: id,
        section: "rules",
        source: `rules:${id}`,
        trust: "trusted_instruction",
      });
    }
    for (const id of system.includedSkillIds) {
      provenance.push({
        blockId: id,
        section: "skills",
        source: `skills:${id}`,
        trust: "trusted_instruction",
      });
    }
    for (const id of system.includedMemoryIds) {
      provenance.push({
        blockId: id,
        section: "memory",
        source: `memory:${id}`,
        trust: "trusted_instruction",
      });
    }
    for (const omitted of system.omitted) {
      omissions.push({
        section: omitted.section,
        reason: "budget",
        detail: `Omitted instruction block ${omitted.id}`,
        tokens: omitted.tokens,
        source: omitted.id,
      });
    }

    const rulesUsed = sumInstructionTokens(
      parsed.instructions?.projectRules ?? [],
      system.includedRuleIds,
      this.estimator,
    );
    const skillsUsed = sumInstructionTokens(
      parsed.instructions?.skills ?? [],
      system.includedSkillIds,
      this.estimator,
    );
    const memoryUsed = sumInstructionTokens(
      parsed.instructions?.memory ?? [],
      system.includedMemoryIds,
      this.estimator,
    );
    const systemCoreUsed = Math.max(
      0,
      system.usedTokens -
        rulesUsed -
        skillsUsed -
        memoryUsed -
        system.planUsedTokens,
    );

    sections = updateSectionBudget(sections, "system", {
      usedTokens: systemCoreUsed,
      truncatedTokens: system.truncatedTokens,
      omittedTokens: 0,
    });
    sections = updateSectionBudget(sections, "rules", {
      usedTokens: rulesUsed,
      omittedTokens: system.omitted
        .filter((item) => item.section === "rules")
        .reduce((sum, item) => sum + item.tokens, 0),
    });
    sections = updateSectionBudget(sections, "skills", {
      usedTokens: skillsUsed,
      omittedTokens: system.omitted
        .filter((item) => item.section === "skills")
        .reduce((sum, item) => sum + item.tokens, 0),
    });
    sections = updateSectionBudget(sections, "memory", {
      usedTokens: memoryUsed,
      omittedTokens: system.omitted
        .filter((item) => item.section === "memory")
        .reduce((sum, item) => sum + item.tokens, 0),
    });
    const planAllocated =
      system.planUsedTokens > 0
        ? Math.max(system.planUsedTokens, parsed.planBudgetTokens ?? 0)
        : 0;
    sections = updateSectionBudget(sections, "plan", {
      allocatedTokens: planAllocated,
      usedTokens: system.planUsedTokens,
    });

    const toolsResult = serializeTools({
      decision: parsed.decision,
      tools: parsed.tools,
      capabilities: parsed.capabilities,
      estimator: this.estimator,
      budgetTokens: sectionAlloc("tools"),
    });
    for (const code of toolsResult.reasonCodes) {
      if (code === "tools_omitted_unsupported") {
        reasonCodes.push("tools_omitted_unsupported");
      } else if (code === "tools_filtered_by_grant") {
        reasonCodes.push("tools_filtered_by_grant");
      }
    }
    for (const omission of toolsResult.omissions) {
      omissions.push({
        section: "tools",
        reason:
          omission.detail === "capability_unsupported"
            ? "capability_unsupported"
            : omission.detail === "grant_empty"
              ? "grant_empty"
              : "budget",
        detail: `Tool ${omission.source} omitted (${omission.detail})`,
        tokens: omission.tokens,
        source: omission.source,
      });
    }
    sections = updateSectionBudget(sections, "tools", {
      usedTokens: toolsResult.usedTokens,
      omittedTokens: toolsResult.omittedTokens,
    });

    // Keep "Allowed tools:" prose aligned with schemas actually attached.
    // Otherwise models refuse apply_patch when the grant lists it but budget
    // packing previously dropped the definition (or vice versa after resume).
    if (toolsResult.tools && toolsResult.tools.length > 0) {
      const allowedLine = `Allowed tools: ${toolsResult.tools
        .map((tool) => tool.name)
        .join(", ")}.`;
      systemContent = systemContent.replace(
        /Allowed tools: [^\n]+/,
        allowedLine,
      );
    }

    const conversationBudget = sectionAlloc("conversation");
    const rawUserRequest = wrapUserRequest(parsed.userMessage);
    const rawUserRequestTokens = this.estimator.estimate(rawUserRequest);
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
      estimator: this.estimator,
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
            (block.tokenEstimate ?? this.estimator.estimate(block.content)),
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
        estimator: this.estimator,
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
      this.estimator,
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

    const messages: ModelMessage[] = [
      { role: "system", content: systemContent },
      ...conversationResult.messages,
      { role: "user", content: userContent },
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
        this.estimator,
      );
      if (emergency.usedTokens < userRequestTokens) {
        const fittedUserContent = [repositoryContent, emergency.content]
          .filter((part) => part.length > 0)
          .join("\n\n");
        messages[messages.length - 1] = {
          role: "user",
          content: fittedUserContent,
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

    const dynamicOutput = resolveDynamicOutputTokens({
      contextWindowTokens: allocation.contextWindowTokens,
      configuredOutputTokens: parsed.capabilities.maximumOutputTokens,
      outputReservedTokens: allocation.outputReservedTokens,
      usedInputTokens: recomputedUsed,
    });
    reasonCodes.push(...dynamicOutput.reasonCodes);

    const request: ModelRequest = {
      messages,
      model: parsed.model ?? parsed.capabilities.modelId,
      temperature: parsed.temperature,
      maximumOutputTokens: dynamicOutput.maximumOutputTokens,
      stream: parsed.stream,
      tools: toolsResult.tools,
      toolChoice: toolsResult.toolChoice,
    };

    const withinLimits = recomputedUsed <= allocation.inputBudgetTokens;
    if (withinLimits) {
      reasonCodes.push("within_provider_limits");
    } else {
      reasonCodes.push("blocked_required_overflow");
      warnings.push(
        "Constructed prompt exceeds input budget after required sections; status is blocked.",
      );
    }

    const totalOmittedTokens = sections.reduce(
      (sum, entry) => sum + entry.omittedTokens,
      0,
    );
    const totalTruncatedTokens = sections.reduce(
      (sum, entry) => sum + entry.truncatedTokens,
      0,
    );

    const status = !withinLimits
      ? "blocked"
      : omissions.some(
            (item) => item.reason === "budget" || item.reason === "duplicate",
          )
        ? "partial"
        : "complete";

    try {
      return promptConstructionResultSchema.parse({
        schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
        status,
        request,
        budget: {
          contextWindowTokens: allocation.contextWindowTokens,
          outputReservedTokens: allocation.outputReservedTokens,
          inputBudgetTokens: allocation.inputBudgetTokens,
          sections,
          totalUsedTokens: recomputedUsed,
          totalOmittedTokens,
          totalTruncatedTokens,
          withinLimits,
        },
        provenance,
        omissions,
        warnings,
        reasonCodes: uniqueReasonCodes(reasonCodes),
      });
    } catch (error) {
      throw new PromptConstructionError(
        "serialization_failed",
        "Prompt Construction result failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

function uniqueReasonCodes(
  codes: readonly PromptReasonCode[],
): PromptReasonCode[] {
  return [...new Set(codes)];
}

function sumInstructionTokens(
  blocks: readonly { id: string; content: string }[],
  includedIds: readonly string[],
  estimator: TokenEstimatorPort,
): number {
  const included = new Set(includedIds);
  return blocks
    .filter((block) => included.has(block.id))
    .reduce((sum, block) => sum + estimator.estimate(block.content), 0);
}
