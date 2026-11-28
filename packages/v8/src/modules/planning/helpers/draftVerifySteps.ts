import type { PlanArtifact, PlanStep, PlanningTaskEvidence } from "../contracts";
import { PLANNING_WORKING_SET_POLICY } from "../rules";
import { doneOutcome } from "./draftPlanEvidence";
import { clipPhrase, slugify, step, uniqueStrings } from "./draftPlanShared";
import { isRepairIntent, scopeLabel } from "./draftPlanPhrases";

export function buildVerifySteps(
  evidence: PlanningTaskEvidence,
  objective: string,
  targetRefs: readonly string[],
  verification: PlanArtifact["verification"],
): PlanStep[] {
  const scope = scopeLabel(targetRefs);
  const shortObjective = clipPhrase(objective, 80);
  const riskLevel = evidence.risk === "low" ? "low" : "medium";
  const outcome = doneOutcome(evidence, shortObjective);
  const maxSteps = PLANNING_WORKING_SET_POLICY.maxVerifySteps;

  // Discovery-supplied commands → one concrete Verify row per command.
  if (verification.commands.length > 0) {
    return verification.commands.slice(0, maxSteps).map((command, index) =>
      step(
        uniqueVerifyStepId("cmd", command, index),
        clipPhrase(`Run ${command}${scope}`, 200),
        pickVerifyTargetRefs(targetRefs, "command"),
        `Execute \`${command}\` on the changed surfaces and confirm "${shortObjective}" still holds.`,
        outcome,
        riskLevel,
        command,
      ),
    );
  }

  // Otherwise keep a single Verify step, but enrich it with the check matrix
  // (automated + tests + manual) so hosts see concrete guidance.
  const automated = verification.checks.filter(
    (check) => check !== "tests" && check.length > 0,
  );
  const wantsTests = verification.checks.includes("tests");
  const checkParts = [
    automated.length > 0 ? automated.join(", ") : undefined,
    wantsTests ? "focused tests" : undefined,
    ...verification.manualQa.map((item) => clipPhrase(item, 80)),
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  const checkText =
    checkParts.length > 0
      ? checkParts.join("; ")
      : "applicable automated and manual checks";
  const intent = isRepairIntent(evidence)
    ? `Verify the fix${scope}`
    : `Verify changes${scope}`;
  const testTargets = wantsTests
    ? pickVerifyTargetRefs(targetRefs, "tests")
    : [];
  const verifyTargets =
    testTargets.length > 0
      ? uniqueStrings([...targetRefs.slice(0, 6), ...testTargets]).slice(0, 8)
      : targetRefs;

  return [
    step(
      "step-verify",
      clipPhrase(intent, 200),
      verifyTargets,
      `Run ${checkText} for the changed surfaces and confirm "${shortObjective}" still holds.`,
      outcome,
      riskLevel,
      checkText,
    ),
  ];
}

function uniqueVerifyStepId(
  kind: string,
  seed: string,
  index: number,
): string {
  const slug = slugify(seed).slice(0, 24) || String(index + 1);
  return `step-verify-${kind}-${slug}`.slice(0, 64);
}

function pickVerifyTargetRefs(
  targetRefs: readonly string[],
  kind: "command" | "automated" | "tests" | "manual",
): string[] {
  if (targetRefs.length === 0) {
    return [];
  }
  if (kind === "tests") {
    const tests = targetRefs.filter(
      (ref) =>
        /\.(?:test|spec)\.\w+$/i.test(ref) ||
        /(?:^|\/)(?:__)?tests?(?:\/|$)/i.test(ref),
    );
    if (tests.length > 0) {
      return tests.slice(0, 8);
    }
  }
  return targetRefs.slice(0, 8);
}
