import { describe, expect, it } from "vitest";

import {
  computeSizeDraft,
  countApproxWords,
  looksLikePasteDump,
  looksLikeTestFailurePaste,
} from "../intent/evidence/sizeDraft";
import { buildUnderstandingEvidencePack } from "../intent/evidence/buildUnderstandingEvidencePack";
import { RuleIntentClassifier } from "../intent/classifiers/rule/RuleIntentClassifier";

describe("sizeDraft investigator", () => {
  it("marks short single-file asks as small", () => {
    const draft = computeSizeDraft({
      text: "Fix the login button label",
      pinnedFolder: false,
      pinnedFileCount: 1,
    });
    expect(draft.taskSize).toBe("small");
    expect(draft.reasons).toContain("single_short_ask");
  });

  it("elevates pinned folder to at least medium", () => {
    const draft = computeSizeDraft({
      text: "rename the helper",
      pinnedFolder: true,
      pinnedFileCount: 0,
    });
    expect(draft.taskSize).toBe("medium");
    expect(draft.reasons).toContain("pinned_folder");
  });

  it("elevates long pastes and test failure dumps to medium+", () => {
    const words = Array.from({ length: 320 }, (_, i) => `w${i}`).join(" ");
    expect(
      computeSizeDraft({
        text: words,
        pinnedFolder: false,
        pinnedFileCount: 0,
      }).taskSize,
    ).toBe("medium");

    const dump = [
      "Failed Tests 2",
      "FAIL apps/vscode/tests/a.test.ts > case",
      "AssertionError: expected false to be true",
      "FAIL packages/v8/tests/b.test.ts > other",
    ].join("\n");
    expect(looksLikeTestFailurePaste(dump)).toBe(true);
    expect(looksLikePasteDump(dump)).toBe(true);
    const draft = computeSizeDraft({
      text: dump,
      pinnedFolder: false,
      pinnedFileCount: 0,
    });
    expect(draft.taskSize).toBe("medium");
  });

  it("counts approximate words", () => {
    expect(countApproxWords("one two three")).toBe(3);
    expect(countApproxWords("")).toBe(0);
  });
});

describe("buildUnderstandingEvidencePack", () => {
  it("includes mode, rule priors, and size draft", () => {
    const classifier = new RuleIntentClassifier();
    const message = "Fix the failing tests in src/auth.test.ts";
    const priors = classifier.listPriors(message);
    const pack = buildUnderstandingEvidencePack({
      mode: "agent",
      turnKind: "new",
      messageText: message,
      originalMessageLength: message.length,
      referencedArtifacts: [
        { name: "auth.test.ts", path: "src/auth.test.ts", kind: "file" },
      ],
      rulePriors: priors,
      requiredMcpServerIds: ["github"],
    });

    expect(pack.mode).toBe("agent");
    expect(pack.artifacts.pinnedFile).toBe(true);
    expect(pack.mcp.requiredServerIds).toEqual(["github"]);
    expect(pack.skills.availableTags.length).toBeGreaterThan(0);
    expect(pack.sizeDraft.taskSize).toMatch(/small|medium|large/);
  });
});
