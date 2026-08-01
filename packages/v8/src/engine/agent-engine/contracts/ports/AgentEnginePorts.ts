import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../../../modules/decision-policy";
import type { LlmPort, ModelToolDefinition } from "../../../../modules/model-gateway";
import type {
  PromptConstructionInput,
  PromptConstructionResult,
} from "../../../../modules/prompt-construction";
import type {
  MemoryRetrieveInput,
  MemoryRetrieveResult,
} from "../../../../modules/memory";
import type {
  PlanningInput,
  PlanningResult,
} from "../../../../modules/planning";
import type {
  RepositoryContextPipelineInput,
  RepositoryContextPipelineResult,
} from "../../../../modules/repository-context";
import type {
  PinRepositoryStateInput,
  PinRepositoryStateResult,
  RepositoryStateDescriptor,
  UnpinRepositoryStateInput,
  UnpinRepositoryStateResult,
} from "../../../../modules/repository-state";
import type { CreateUserRequestInput, UserRequestEnvelope } from "../../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";
import type {
  SkillsSelectInput,
  SkillsSelectResult,
} from "../../../../modules/skills";
import type {
  ToolApprovalToken,
  ToolExecuteOptions,
  ToolInvocationInput,
  ToolResult,
} from "../../../tool-runtime";
import type {
  VerificationInput,
  VerificationResult,
} from "../../../../modules/verification";

import type { AgentEngineRunCheckpointStorePort } from "../../internal/RunCheckpoint";

export interface AgentEngineClockPort {
  now(): Date;
}

export interface AgentEngineIdGeneratorPort {
  next(prefix: string): string;
}

export interface AgentEngineIntakePort {
  intake(input: CreateUserRequestInput): UserRequestEnvelope;
}

export interface AgentEngineUnderstandingPort {
  understand(
    input: UserRequestEnvelope,
  ): Promise<RequestUnderstandingResult>;
}

export interface AgentEngineDecisionPort {
  decide(input: DecisionPolicyInput): ExecutionDecision;
}

export interface AgentEnginePromptPort {
  construct(input: PromptConstructionInput): PromptConstructionResult;
}

export interface AgentEngineSkillsPort {
  select(input: SkillsSelectInput): Promise<SkillsSelectResult>;
}

export interface AgentEngineMemoryPort {
  retrieve(input: MemoryRetrieveInput): Promise<MemoryRetrieveResult>;
}

export interface AgentEnginePlanningPort {
  plan(input: PlanningInput): PlanningResult;
}

export interface AgentEngineRepositoryStatePort {
  pin(input: PinRepositoryStateInput): Promise<PinRepositoryStateResult>;
  unpin(input: UnpinRepositoryStateInput): Promise<UnpinRepositoryStateResult>;
  getLatest(workspaceId: string): Promise<RepositoryStateDescriptor | undefined>;
}

export interface AgentEngineRepositoryContextPort {
  execute(
    input: RepositoryContextPipelineInput,
  ): Promise<RepositoryContextPipelineResult>;
}

export interface AgentEngineToolRuntimePort {
  execute(
    input: ToolInvocationInput,
    options?: ToolExecuteOptions,
  ): Promise<ToolResult>;
  createBudget?(grant: ToolGrant): unknown;
  rollbackMutation?(input: {
    checkpointId: string;
  }): Promise<ToolResult>;
  commitMutation?(checkpointId: string): void;
  /** Honest grant gating — omit / false when SearchPort is not injected. */
  hasSearchPort?(): boolean;
  hasDiagnosticsPort?(): boolean;
}

export interface AgentEngineVerificationPort {
  verify(input: VerificationInput): Promise<VerificationResult>;
}

/**
 * Dependencies injected by the Application layer / tests.
 * Engine coordinates these public facades; it does not reimplement them.
 * Skills, Memory, and Planning are optional — omitting leaves the core loop intact.
 */
export interface AgentEngineDependencies {
  intake: AgentEngineIntakePort;
  understanding: AgentEngineUnderstandingPort;
  decision: AgentEngineDecisionPort;
  prompt: AgentEnginePromptPort;
  llm: LlmPort;
  skills?: AgentEngineSkillsPort;
  memory?: AgentEngineMemoryPort;
  planning?: AgentEnginePlanningPort;
  repositoryState?: AgentEngineRepositoryStatePort;
  repositoryContext?: AgentEngineRepositoryContextPort;
  tools?: AgentEngineToolRuntimePort;
  verification?: AgentEngineVerificationPort;
  checkpointStore?: AgentEngineRunCheckpointStorePort;
  /** Defaults to policy DEFAULT_TOOL_DEFINITIONS when omitted. */
  toolDefinitions?: readonly ModelToolDefinition[];
  clock?: AgentEngineClockPort;
  idGenerator?: AgentEngineIdGeneratorPort;
}

export type { ToolApprovalToken };
