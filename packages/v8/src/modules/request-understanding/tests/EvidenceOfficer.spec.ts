import { describe, expect, it } from "vitest";

import {
  computeSizeDraft,
  countApproxTokens,
  countApproxWords,
  defaultPlanningHintForSize,
  looksLikePasteDump,
  looksLikeTestFailurePaste,
  TOKEN_MEDIUM_CANDIDATE,
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

  it("does not elevate size for pinned folder alone (scope root only)", () => {
    const draft = computeSizeDraft({
      text: "rename the helper",
      pinnedFolder: true,
      pinnedFileCount: 0,
    });
    expect(draft.taskSize).toBe("small");
    expect(draft.reasons).toContain("pinned_folder_scope_only");
    expect(draft.reasons).not.toContain("pinned_folder");
  });

  it("uses token bands as medium/large candidates", () => {
    const mediumText = "x".repeat(TOKEN_MEDIUM_CANDIDATE * 4);
    expect(countApproxTokens(mediumText)).toBeGreaterThanOrEqual(
      TOKEN_MEDIUM_CANDIDATE,
    );
    expect(
      computeSizeDraft({
        text: mediumText,
        pinnedFolder: false,
        pinnedFileCount: 0,
      }).taskSize,
    ).toBe("medium");

    const largeText = "y".repeat(2100 * 4);
    expect(
      computeSizeDraft({
        text: largeText,
        pinnedFolder: false,
        pinnedFileCount: 0,
      }).taskSize,
    ).toBe("large");
  });

  it("elevates test failure dumps to medium+", () => {
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

  it("defaults small planning hint to short", () => {
    expect(defaultPlanningHintForSize("small")).toBe("short");
    expect(defaultPlanningHintForSize("medium")).toBe("short");
    expect(defaultPlanningHintForSize("large")).toBe("long");
  });

  it("counts approximate words and tokens", () => {
    expect(countApproxWords("one two three")).toBe(3);
    expect(countApproxWords("")).toBe(0);
    expect(countApproxTokens("abcd")).toBe(1);
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
    expect(pack.projectFingerprint?.relativeRoots.length).toBeGreaterThan(0);
    expect(pack.projectFingerprint?.fileExtensions).toContain("ts");
  });

  it("keeps short nav-label asks small and fingerprints pinned folders", () => {
    const message = "Change the nav label to Docs";
    const pack = buildUnderstandingEvidencePack({
      mode: "agent",
      turnKind: "new",
      messageText: message,
      originalMessageLength: message.length,
      referencedArtifacts: [
        { name: "website", path: "apps/website", kind: "folder" },
      ],
    });
    expect(pack.sizeDraft.taskSize).toBe("small");
    expect(pack.sizeDraft.reasons).toContain("localized_ui_copy_small");
    expect(pack.projectFingerprint?.relativeRoots).toContain("apps/website");
  });
});
