import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_THRESHOLDS } from "../../policy";
import {
  buildCodeIntelAdoptionNudgeMessage,
  resolveReasoningProgressBudget,
  shouldNudgeCodeIntelAdoption,
} from "../resolveReasoningAndCodeIntelNudges";

describe("resolveReasoningProgressBudget", () => {
  it("keeps the base starting budget when reasoning is not advertised", () => {
    const budget = resolveReasoningProgressBudget({
      supportsReasoning: false,
    });
    expect(budget.baseChars).toBe(
      AGENT_ENGINE_THRESHOLDS.maxReasoningCharsWithoutProgress,
    );
    expect(budget.tightChars).toBe(
      Math.max(
        2_000,
        Math.floor(
          AGENT_ENGINE_THRESHOLDS.maxReasoningCharsWithoutProgress *
            AGENT_ENGINE_THRESHOLDS.reasoningProgressBudgetRatioWhenReasoningCapable,
        ),
      ),
    );
  });

  it("starts tight when reasoning is advertised or already observed", () => {
    const capable = resolveReasoningProgressBudget({
      supportsReasoning: true,
    });
    const observed = resolveReasoningProgressBudget({
      supportsReasoning: false,
      observedReasoningChannel: true,
    });
    expect(capable.baseChars).toBe(capable.tightChars);
    expect(observed.baseChars).toBe(observed.tightChars);
    expect(capable.baseChars).toBeLessThan(
      AGENT_ENGINE_THRESHOLDS.maxReasoningCharsWithoutProgress,
    );
  });

  it("honors threshold overrides", () => {
    expect(
      resolveReasoningProgressBudget({
        supportsReasoning: true,
        thresholds: {
          maxReasoningCharsWithoutProgress: 10_000,
          reasoningProgressBudgetRatioWhenReasoningCapable: 0.2,
        },
      }).tightChars,
    ).toBe(2_000);
  });
});

describe("shouldNudgeCodeIntelAdoption", () => {
  const tools = ["read_file", "document_symbol", "goto_definition"] as const;

  it("nudges after enough file-body reads with no code-intel use", () => {
    expect(
      shouldNudgeCodeIntelAdoption({
        allowedTools: tools,
        codeIntelligenceToolIds: ["document_symbol", "goto_definition"],
        successfulFileBodyReads: 8,
        codeIntelToolUses: 0,
        nudgesUsed: 0,
      }),
    ).toBe(true);
  });

  it("skips when code-intel already used or nudge budget spent", () => {
    expect(
      shouldNudgeCodeIntelAdoption({
        allowedTools: tools,
        codeIntelligenceToolIds: ["document_symbol"],
        successfulFileBodyReads: 20,
        codeIntelToolUses: 1,
        nudgesUsed: 0,
      }),
    ).toBe(false);
    expect(
      shouldNudgeCodeIntelAdoption({
        allowedTools: tools,
        codeIntelligenceToolIds: ["document_symbol"],
        successfulFileBodyReads: 20,
        codeIntelToolUses: 0,
        nudgesUsed: 1,
      }),
    ).toBe(false);
  });

  it("skips when no code-intel tools are granted", () => {
    expect(
      shouldNudgeCodeIntelAdoption({
        allowedTools: ["read_file", "search_files"],
        codeIntelligenceToolIds: ["document_symbol"],
        successfulFileBodyReads: 20,
        codeIntelToolUses: 0,
        nudgesUsed: 0,
      }),
    ).toBe(false);
  });

  it("buildCodeIntelAdoptionNudgeMessage lists granted tools", () => {
    expect(
      buildCodeIntelAdoptionNudgeMessage(["document_symbol", "goto_definition"]),
    ).toContain("document_symbol, goto_definition");
  });
});
