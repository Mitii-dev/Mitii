import type {
  PlanArtifact,
  PlanClarifyDraft,
  PlanStrategyDecision,
  PlanningParsedInput,
  PlanningReasonCode,
  PlanningStatus,
} from "../contracts";

/** Mutable plan() flow state shared across numbered steps. */
export type PlanFlowState = {
  parsed: PlanningParsedInput;
  strategyDecision: PlanStrategyDecision;
  strategyWarnings: string[];
  strategyReasonCodes: PlanningReasonCode[];
  drafted: PlanArtifact;
  draftWarnings: string[];
  draftReasonCodes: PlanningReasonCode[];
  draftedFromDiscovery: boolean;
  needsScopeFork: boolean;
  clarifyDraft?: PlanClarifyDraft;
  status?: PlanningStatus;
  usedTokens?: number;
  blocked?: boolean;
};
