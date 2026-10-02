/**
 * Skills select for execute-start enrichment. Soft-prefers size-routed skills.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PromptInstructions,
  PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import {
  SKILLS_SCHEMA_VERSION,
  formatSkillPromptContent,
  mapUnderstandingToSkillEvidence,
} from "../../../modules/skills";
import type { WindowPolicy } from "../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../modules/window-budget";

import { buildSkillsReadyEvent } from "./buildSkillsReadyEvent";
import { resolvePreferredSkillIdsForRun } from "./resolvePreferredSkillIds";
import type { AgentEngineStartInput, AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import type { AgentEngineRuntime } from "../pipeline/runtime";

export async function selectSkillsForEnrichment(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  contextPaths: string[];
}): Promise<{
  selectedSkills: PromptInstructions["skills"];
  skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
}> {
  const {
    runtime,
    runId,
    input,
    bus,
    windowPolicy,
    reasonCodes,
    warnings,
    envelope,
    understanding,
    decision,
    contextPaths,
  } = params;

  let selectedSkills: PromptInstructions["skills"];
  let skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
  const injectSkillCatalogL1 =
    resolveSteeringFeatureFlags(input.steering).injectSkillCatalogL1 === true;

  if (!runtime.deps.skills) {
    reasonCodes.push("skills_skipped");
    return { selectedSkills, skillCatalogL1 };
  }

  runtime.emitStage(bus, runId, "skills_ready", "started");
  const understandingSkillEvidence = mapUnderstandingToSkillEvidence(
    understanding,
    {
      projects: input.projects,
      extraPaths: [...(input.dirtyPaths ?? []), ...contextPaths],
    },
  );
  const skillEvidencePaths = [...new Set(understandingSkillEvidence.paths)]
    .filter((path: string) => path.trim().length > 0)
    .slice(0, 50);
  const preferredSkillIds = resolvePreferredSkillIdsForRun({
    taskSize: understanding.taskAnalysis?.taskSize,
    route: decision.route,
  });
  const skillsResult = await runtime.deps.skills.select({
    schemaVersion: SKILLS_SCHEMA_VERSION,
    query: extractPrimaryUserMessage(envelope.message),
    mode: envelope.mode,
    route: decision.route,
    budgetTokens: windowPolicy.skills.budgetTokens,
    maxSkills: windowPolicy.skills.maxSkills,
    requiredSkillIds: input.requiredSkillIds ?? [],
    preferredSkillIds,
    excludedSkillIds: input.excludedSkillIds ?? [],
    forbidLargeSkills:
      resolveWindowBudgetBand(windowPolicy.contextWindowTokens) === "compact",
    includeCatalogL1: injectSkillCatalogL1,
    evidence: {
      ...understandingSkillEvidence,
      paths: skillEvidencePaths,
    },
  });
  selectedSkills = skillsResult.instructions.map((block) => ({
    id: block.id,
    title: block.title,
    content: formatSkillPromptContent(block),
    priority: block.priority,
  }));
  if (
    injectSkillCatalogL1 &&
    skillsResult.catalogL1 &&
    skillsResult.catalogL1.length > 0
  ) {
    skillCatalogL1 = skillsResult.catalogL1;
  }
  if (
    skillsResult.warnings.length > 0 &&
    logVerbosityAtLeast(input.logVerbosity, "verbose")
  ) {
    warnings.push(...skillsResult.warnings);
  }
  reasonCodes.push(
    skillsResult.instructions.length > 0 ? "skills_selected" : "skills_skipped",
  );
  runtime.emit(
    bus,
    buildSkillsReadyEvent({
      runId,
      skillsResult,
      at: runtime.isoNow(),
    }),
  );
  runtime.emitStage(bus, runId, "skills_ready", "completed", [
    skillsResult.instructions.length > 0 ? "skills_selected" : "skills_skipped",
  ]);

  return { selectedSkills, skillCatalogL1 };
}
