import { describe, expect, it } from "vitest";

import {
  amendMessageWithPriorConversation,
  buildIncompleteAnswerRecoveryMessage,
  hasLeakedToolCallMarkup,
  isDegenerateRepeatedAnswer,
  isEmptyAssistantTurn,
  isPseudoToolRequestAnswer,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
  shouldRecoverIncompleteAssistantTurn,
  synthesizeFallbackAnswer,
} from "../isIncompleteAssistantTurn";

describe("isIncompleteAssistantTurn", () => {
  it("detects empty turns", () => {
    expect(
      isEmptyAssistantTurn({ content: "", toolCallCount: 0 }),
    ).toBe(true);
    expect(
      isEmptyAssistantTurn({ content: "hi", toolCallCount: 0 }),
    ).toBe(false);
    expect(
      isEmptyAssistantTurn({ content: "", toolCallCount: 1 }),
    ).toBe(false);
  });

  it("detects transitional narration from the billbuddy logs", () => {
    expect(
      isTransitionalAssistantAnswer(
        "Let me check kitchen-flow.spec.ts more carefully:",
      ),
    ).toBe(true);
    expect(
      isTransitionalAssistantAnswer(
        "Now let me read more files to understand the full picture:",
      ),
    ).toBe(true);
    expect(
      isTransitionalAssistantAnswer(
        "Now let me do the same for the Tablet BasePage - delete and recreate it extending the shared base:",
      ),
    ).toBe(true);
    expect(
      isTransitionalAssistantAnswer(
        "All selector naming is now consistent. Let me run the verification steps from the plan - lint and typecheck:",
      ),
    ).toBe(true);
    expect(
      isTransitionalAssistantAnswer(
        "Yes — the old Desktop/Tablet page objects were removed and imports were updated.",
      ),
    ).toBe(false);
  });

  it("detects instruction-shaped pseudo tool requests from thinking models", () => {
    const answer = [
      "I'll look at the existing analytics service files and bill/item models to understand the current structure before designing the API.",
      "",
      "<user_request trust=\"instruction\">",
      "Read the following files:",
      "- app/admin/services/analytics/analytics.api.ts",
      "- app/admin/services/analytics/analytics.router.ts",
      "- app/admin/model/bill-modal.ts",
      "</user_request>",
    ].join("\n");

    expect(isPseudoToolRequestAnswer(answer)).toBe(true);
    expect(isTransitionalAssistantAnswer(answer)).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
  });

  it("detects literal tool tags emitted as text", () => {
    const answer = [
      "Let me check the relevant files for the ffb-mui preview setup.",
      "",
      '<read_file path="apps/docs/src/components/live-demo-mui.tsx"> </read_file>',
    ].join("\n");

    expect(isPseudoToolRequestAnswer(answer)).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
  });

  it("recovers long unfinished investigation monologues with leaked tool markup", () => {
    const answer = [
      "everything looks correct in the code. The SELECT type is defined, the FieldSelect component exists, and it's properly imported in the dynamic field renderer.",
      "",
      "The issue might be that the LiveError component is rendered but not showing anything visible, or there could be a runtime error that's being swallowed by react-live.",
      "",
      "Let me think about what could cause the select to not work while multi-text does:",
      "",
      "1. Both use the same live-demo-mui component",
      "2. Both import from ffb-mui",
      "3. The SELECT type is defined and exported",
      "4. The FieldSelect component exists",
      "",
      "Wait - looking at the user's original complaint again.",
      "",
      "Actually, I think the real issue might be simpler - let me re-read the user's original request more carefully.",
      "",
      "But first, let me check the ffb-mui index exports to make sure FieldSelect is properly exported.",
      "</parameter>",
      "</function>",
      "</tool_call>",
    ].join("\n");

    expect(answer.length).toBeGreaterThan(600);
    expect(hasLeakedToolCallMarkup(answer)).toBe(true);
    expect(isUnfinishedInvestigationAnswer(answer)).toBe(true);
    expect(isPseudoToolRequestAnswer(answer)).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
  });

  it("recovers long answers that end with continue-investigation intent without markup", () => {
    const answer = [
      "I compared the working core-docs multi-text page with the broken ffb-mui select introduction.",
      "Both appear to share the live demo wrapper, and the package exports look present.",
      "There may still be a transform or scope issue in the MDX example.",
      "But first, let me check the live-demo-mui transformCode path once more.",
    ].join("\n");

    expect(answer.length).toBeGreaterThan(200);
    expect(isUnfinishedInvestigationAnswer(answer)).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
  });

  it("recovers a long pre-fix dump that ends with let me start", () => {
    const answer = [
      "There's no FieldType exported from the types index.",
      "Let me now plan all the fixes:",
      "1. Create a FieldType interface",
      "2. Fix InputTypes",
      "3. Add field property to all field component Props interfaces",
      "Let me start with the most impactful changes first - the types that affect everything else.",
    ].join("\n");

    expect(isUnfinishedInvestigationAnswer(answer)).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
  });

  it("does not recover finished investigative answers", () => {
    const answer = [
      "Root cause: live-demo-mui strips imports inconsistently for SELECT demos.",
      "I updated apps/docs/src/components/live-demo-mui.tsx so transformCode always runs.",
      "Verification: typecheck passed and the preview path should load again.",
    ].join("\n");

    expect(isUnfinishedInvestigationAnswer(answer)).toBe(false);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: answer,
        toolCallCount: 0,
        changedFileCount: 1,
      }),
    ).toBe(false);
  });

  it("recovers empty and transitional finals", () => {
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: "",
        toolCallCount: 0,
        changedFileCount: 3,
      }),
    ).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: "Let me explore the project:",
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content:
          "All selector naming is now consistent. Let me run the verification steps from the plan - lint and typecheck:",
        toolCallCount: 0,
        changedFileCount: 5,
      }),
    ).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: "Let me explore the project:",
        toolCallCount: 2,
        changedFileCount: 0,
      }),
    ).toBe(false);
  });

  it("detects long repeating numbered diagnoses as degenerate", () => {
    const lines = Array.from({ length: 24 }, (_, index) => {
      const name = ["alpha.ts", "beta.ts", "gamma.ts"][index % 3];
      return `${index + 1}. **${name}** - the same structural type mismatch appears after the config-object change.`;
    });
    const content = `Now I have a clear picture of the remaining errors.\n\n${lines.join("\n")}\n`;
    expect(content.length).toBeGreaterThan(2_000);
    expect(isDegenerateRepeatedAnswer(content)).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content,
        toolCallCount: 0,
        changedFileCount: 2,
      }),
    ).toBe(true);
  });

  it("does not treat a long unique analysis as degenerate", () => {
    const content = Array.from({ length: 40 }, (_, index) => {
      return `Section ${index}: unique finding about module-${index} and its contract.`;
    }).join("\n");
    expect(content.length).toBeGreaterThan(2_000);
    expect(isDegenerateRepeatedAnswer(content)).toBe(false);
  });

  it("builds recovery and fallback answers", () => {
    const recovery = buildIncompleteAnswerRecoveryMessage({
      changedFiles: ["a.ts", "b.ts"],
      emptyTurn: true,
    });
    expect(recovery).toContain("no content");
    expect(recovery).toContain("a.ts");

    expect(
      synthesizeFallbackAnswer({
        priorAnswer: "Let me check carefully:",
        changedFiles: ["test/a.ts"],
      }),
    ).toContain("Completed workspace edits");

    expect(
      synthesizeFallbackAnswer({
        priorAnswer:
          "All selector naming is now consistent. Let me run the verification steps from the plan - lint and typecheck:",
        changedFiles: ["test/shared/pages/BasePage.ts"],
      }),
    ).toMatch(/^Completed workspace edits/);
  });

  it("amends understanding message with prior conversation", () => {
    const amended = amendMessageWithPriorConversation(
      "<<<MITII_USER_MESSAGE>>>\ndid you clear the old files ??\n\n<<<MITII_HOST_CONTEXT>>>\nWorkspace file map (2 files):\n- a.ts",
      [
        {
          role: "user",
          content: "restructure this project",
        },
        {
          role: "assistant",
          content: "Completed workspace edits.\nChanged files (2): a.ts, b.ts",
        },
      ],
      (text) => {
        const marker = "<<<MITII_USER_MESSAGE>>>";
        const idx = text.indexOf(marker);
        if (idx < 0) return text;
        const after = text.slice(idx + marker.length).trimStart();
        const hostIdx = after.indexOf("<<<MITII_HOST_CONTEXT>>>");
        return (hostIdx >= 0 ? after.slice(0, hostIdx) : after).trim();
      },
    );
    expect(amended).toContain("Prior conversation");
    expect(amended).toContain("restructure this project");
    expect(amended).toContain("Current user request:");
    expect(amended).toContain("did you clear the old files ??");
    expect(amended).not.toContain("Workspace file map");
  });
});
