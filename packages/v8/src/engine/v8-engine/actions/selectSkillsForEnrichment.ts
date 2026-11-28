/**
 * Engine wiring for skills enrichment — owner is runtime/helpers/skills.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PromptInstructions,
  PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { selectSkillsForEnrichment as runtimeSelectSkillsForEnrichment } from "../../../runtime/helpers/skills";
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
  const { runtime, bus, input } = params;
  const injectSkillCatalogL1 =
    resolveSteeringFeatureFlags(input.steering).injectSkillCatalogL1 === true;

  return runtimeSelectSkillsForEnrichment({
    ports: {
      skills: runtime.deps.skills,
      emitStage: (runId, stage, status, reasonCodes) => {
        runtime.emitStage(
          bus,
          runId,
          stage,
          status,
          reasonCodes as AgentReasonCode[] | undefined,
        );
      },
      emit: (event) => {
        runtime.emit(bus, event);
      },
      isoNow: () => runtime.isoNow(),
    },
    runId: params.runId,
    input,
    windowPolicy: params.windowPolicy,
    reasonCodes: params.reasonCodes,
    warnings: params.warnings,
    envelope: params.envelope,
    understanding: params.understanding,
    decision: params.decision,
    contextPaths: params.contextPaths,
    injectSkillCatalogL1,
    pushSkillWarnings: logVerbosityAtLeast(input.logVerbosity, "verbose"),
  });
}
