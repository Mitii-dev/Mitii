import { describe, expect, it } from "vitest";

import {
  shouldForceCampaignPhaseLock,
  shouldSuspendForPlanScopeFork,
} from "./shouldSuspendForPlanScopeFork";

describe("shouldSuspendForPlanScopeFork", () => {
  it("suspends Plan clarify with a draft", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "plan",
        strategy: "clarify",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
      }),
    ).toBe(true);
  });

  it("suspends Agent clarify only when quality floor applies", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "clarify",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
      }),
    ).toBe(true);
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "clarify",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: false,
      }),
    ).toBe(false);
  });

  it("never suspends clear single-outcome asks even with clarify draft", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "clarify",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
        askNeedsScopeFork: false,
      }),
    ).toBe(false);
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "discover_and_plan",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
        forceCampaignPhaseLock: true,
        askNeedsScopeFork: false,
      }),
    ).toBe(false);
  });

  it("does not suspend after scope is already chosen", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "clarify",
        hasClarifyDraft: true,
        scopeChoiceResolved: true,
        qualityFloor: true,
      }),
    ).toBe(false);
  });

  it("does not suspend non-clarify strategies without campaign lock", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "plan",
        strategy: "discover_and_plan",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
      }),
    ).toBe(false);
  });

  it("suspends Agent discover_and_plan when campaign phase-lock is forced", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "discover_and_plan",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
        forceCampaignPhaseLock: true,
        askNeedsScopeFork: true,
      }),
    ).toBe(true);
  });

  it("does not campaign-lock when askNeedsScopeFork is omitted", () => {
    expect(
      shouldSuspendForPlanScopeFork({
        mode: "agent",
        strategy: "discover_and_plan",
        hasClarifyDraft: true,
        scopeChoiceResolved: false,
        qualityFloor: true,
        forceCampaignPhaseLock: true,
      }),
    ).toBe(false);
  });
});

describe("shouldForceCampaignPhaseLock", () => {
  it("locks Agent visible plans when the ask forks", () => {
    expect(
      shouldForceCampaignPhaseLock({
        mode: "agent",
        planningDepth: "visible",
        qualityFloor: true,
        askNeedsScopeFork: true,
      }),
    ).toBe(true);
  });

  it("does not lock clear single-outcome visible Agent plans", () => {
    expect(
      shouldForceCampaignPhaseLock({
        mode: "agent",
        planningDepth: "visible",
        qualityFloor: true,
        askNeedsScopeFork: false,
      }),
    ).toBe(false);
  });

  it("does not lock when askNeedsScopeFork is omitted", () => {
    expect(
      shouldForceCampaignPhaseLock({
        mode: "agent",
        planningDepth: "visible",
        qualityFloor: true,
      }),
    ).toBe(false);
  });

  it("locks large Change checklists on Agent", () => {
    expect(
      shouldForceCampaignPhaseLock({
        mode: "agent",
        planningDepth: "internal",
        changeStepCount: 7,
        qualityFloor: true,
        askNeedsScopeFork: true,
      }),
    ).toBe(true);
  });

  it("skips small Agent repairs", () => {
    expect(
      shouldForceCampaignPhaseLock({
        mode: "agent",
        planningDepth: "internal",
        changeStepCount: 2,
        qualityFloor: true,
        askNeedsScopeFork: true,
      }),
    ).toBe(false);
  });
});
