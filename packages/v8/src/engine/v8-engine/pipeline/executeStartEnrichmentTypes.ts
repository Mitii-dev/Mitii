import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PromptInstructions,
  PromptRepositoryContext,
  PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { AgentRunResult } from "../contracts";

export type StartEnrichmentContinue = {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  repositoryContext: PromptRepositoryContext | undefined;
  selectedSkills: PromptInstructions["skills"];
  skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
  selectedMemory: PromptInstructions["memory"];
  planText: string | undefined;
};

export type StartEnrichmentOutcome =
  | { kind: "terminal"; result: AgentRunResult }
  | { kind: "continue"; state: StartEnrichmentContinue };
