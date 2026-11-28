/**
 * Skills select for execute-start enrichment. Soft-prefers size-routed skills.
 * Engine wires skills port + emit callbacks; this owns the selection flow.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PromptInstructions,
  PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import {
  SKILLS_SCHEMA_VERSION,
  formatSkillPromptContent,
  mapUnderstandingToSkillEvidence,
  type SkillsSelectInput,
  type SkillsSelectResult,
} from "../../../modules/skills";
import type { WindowPolicy } from "../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../modules/window-budget";

import type { AgentEngineStartInput, AgentReasonCode, RunEvent } from "../../../engine/v8-engine/contracts";

import { buildSkillsReadyEvent } from "./SkillsReadyEvent";
import { resolvePreferredSkillIdsForRun } from "./PreferredSkillIds";

export interface SkillsSelectPort {
  select(input: SkillsSelectInput): Promise<SkillsSelectResult>;
}

export interface SelectSkillsForEnrichmentPorts {
  skills: SkillsSelectPort | undefined;
  emitStage: (
    runId: string,
    stage: "skills_ready",
    status: "started" | "completed",
    reasonCodes?: readonly string[],
  ) => void;
  emit: (event: RunEvent) => void;
  isoNow: () => string;
}

export async function selectSkillsForEnrichment(params: {
  ports: SelectSkillsForEnrichmentPorts;
  runId: string;
  input: AgentEngineStartInput;
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  contextPaths: string[];
  injectSkillCatalogL1: boolean;
  pushSkillWarnings: boolean;
}): Promise<{
  selectedSkills: PromptInstructions["skills"];
  skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
}> {
  const {
    ports,
    runId,
    input,
    windowPolicy,
    reasonCodes,
    warnings,
    envelope,
    understanding,
    decision,
    contextPaths,
    injectSkillCatalogL1,
    pushSkillWarnings,
  } = params;

  let selectedSkills: PromptInstructions["skills"];
  let skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;

  if (!ports.skills) {
    reasonCodes.push("skills_skipped");
    return { selectedSkills, skillCatalogL1 };
  }

  ports.emitStage(runId, "skills_ready", "started");
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
  const skillsResult = await ports.skills.select({
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
  if (skillsResult.warnings.length > 0 && pushSkillWarnings) {
    warnings.push(...skillsResult.warnings);
  }
  reasonCodes.push(
    skillsResult.instructions.length > 0 ? "skills_selected" : "skills_skipped",
  );
  ports.emit(
    buildSkillsReadyEvent({
      runId,
      skillsResult,
      at: ports.isoNow(),
    }),
  );
  ports.emitStage(runId, "skills_ready", "completed", [
    skillsResult.instructions.length > 0 ? "skills_selected" : "skills_skipped",
  ]);

  return { selectedSkills, skillCatalogL1 };
}
