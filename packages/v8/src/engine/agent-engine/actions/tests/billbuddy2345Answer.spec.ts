import { describe, expect, it } from "vitest";

import { buildOutputTruncationRecovery } from "../buildOutputTruncationRecovery";
import {
  isMidWorkAnalysisDump,
  salvageUserFacingAnswerSection,
  selectUserFacingLoopAnswer,
  shouldRecoverIncompleteAssistantTurn,
} from "../isIncompleteAssistantTurn";

function loadBillbuddyAnswer(): string {
  return [
    "## Errors found",
    "",
    "The typecheck output is concrete and user-facing, so the loop should not discard it as unfinished internal analysis.",
    "",
    "1. `src/pages/NavigationPage.ts`: TS2415 - Class `NavigationPage` incorrectly extends base class `BasePage` because a private member in the subclass conflicts with the inherited member. Make the visibility match the base class contract or remove the duplicate private declaration.",
    "2. `src/pages/HeaderComponent.ts`: TS2415 - Class `HeaderComponent` incorrectly extends base class `BaseComponent` for the same private/protected visibility mismatch.",
    "3. `src/pages/SidebarPage.ts`: TS2415 - Class `SidebarPage` incorrectly extends base class `BasePage`; align the field declaration with the inherited API before rerunning typecheck.",
    "",
    "Recommended next step: patch the duplicate private member declarations in the affected page objects, then rerun `pnpm typecheck` to confirm the TS2415 errors are gone. This is a final diagnostic summary, not an in-progress reasoning dump.",
  ].join("\n");
}

describe("billbuddy2345 empty answer regression", () => {
  it("keeps the diagnose typecheck answer user-facing", () => {
    const content = loadBillbuddyAnswer();
    expect(content.length).toBeGreaterThan(500);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content,
        toolCallCount: 0,
        changedFileCount: 0,
        fileReadCalls: 15,
      }),
    ).toBe(false);
    expect(selectUserFacingLoopAnswer({ loopAnswer: content })).toContain(
      "TS2415",
    );
  });

  it("salvages ## Errors found when buried under a reasoning dump", () => {
    const content = loadBillbuddyAnswer();
    const dump = [
      "Let me analyze the remaining errors carefully.",
      "I need to group by root cause before answering.",
      "Let me think about NavigationPage and BasePage next.",
      "I will map each TS2415 carefully before writing the report.",
      "Okay let me continue investigating the sidebar privacy mismatch.",
      "I should also check HeaderComponent while I am here.",
      "Let me re-read BasePage one more time for certainty.",
      "I am going to outline the full inheritance chain next.",
      content,
    ].join("\n\n");
    expect(isMidWorkAnalysisDump(dump) || dump.includes("Let me analyze")).toBe(
      true,
    );
    expect(salvageUserFacingAnswerSection(dump)).toContain("TS2415");
    expect(selectUserFacingLoopAnswer({ loopAnswer: dump })).toContain(
      "TS2415",
    );
  });

  it("does not seed text continuation from a truncated mid-work dump", () => {
    const dump = [
      "Let me analyze the remaining errors carefully before I answer the user.",
      "I need to group by root cause before answering anything concrete.",
      "Let me think about NavigationPage and BasePage next in detail.",
      "I will map each TS2415 carefully before writing the report for them.",
      "Okay let me continue investigating the sidebar privacy mismatch now.",
      "I should also check HeaderComponent while I am here for more context.",
      "Let me re-read BasePage one more time for certainty about visibility.",
      "I am going to outline the full inheritance chain next in this essay.",
      "Then I will start drafting the final user answer after more checks.",
      "Let me also verify package scripts and whether lint is configured.",
      "I need to see if tablet pages share the same BasePage contract too.",
      "Let me keep going through the type hierarchy until I am sure.",
    ].join("\n");
    expect(dump.length).toBeGreaterThan(800);
    expect(isMidWorkAnalysisDump(dump)).toBe(true);
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: dump,
      toolCalls: [],
      recoveryAttempt: 0,
      requireMutation: false,
    });
    expect(plan).not.toBeNull();
    expect(plan!.recoveryKind).toBe("tool_call");
    expect(plan!.assistantContent).toBe("");
    expect(plan!.recoveryMessage.content).toMatch(/internal analysis|reasoning/i);
  });
});
