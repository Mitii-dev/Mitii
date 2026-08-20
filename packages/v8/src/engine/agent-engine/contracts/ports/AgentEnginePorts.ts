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
  MemoryCommitInput,
  MemoryCommitResult,
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
import type {
  DiagnosticSummary,
  RequestUnderstandingResult,
} from "../../../../modules/request-understanding";
import type {
  SkillsSelectInput,
  SkillsSelectResult,
} from "../../../../modules/skills";
import type {
  ToolApprovalToken,
  ToolExecuteOptions,
  ToolInvocationInput,
  ToolResult,
  RepositoryGraphPort,
} from "../../../tool-runtime";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationPipelineOptions,
  VerificationRecord,
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
    diagnosticSummary?: DiagnosticSummary,
  ): Promise<RequestUnderstandingResult>;
}

export interface AgentEngineDecisionPort {
  decide(input: DecisionPolicyInput): ExecutionDecision;
  narrow?(input: {
    previous: ExecutionDecision;
    discoveredPaths?: readonly string[];
    residualRisk?: "low" | "medium" | "high" | "critical";
  }): ExecutionDecision;
}

export interface AgentEnginePromptPort {
  construct(input: PromptConstructionInput): PromptConstructionResult;
}

export interface AgentEngineSkillsPort {
  select(input: SkillsSelectInput): Promise<SkillsSelectResult>;
}

export interface AgentEngineMemoryPort {
  retrieve(input: MemoryRetrieveInput): Promise<MemoryRetrieveResult>;
  commit?(input: MemoryCommitInput): Promise<MemoryCommitResult>;
}

export interface AgentEnginePlanningPort {
  plan(input: PlanningInput): Promise<PlanningResult>;
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
  captureBuildState?(
    input: VerificationInput,
    params: { phase: "before" | "after"; capturedAt?: string },
    options?: VerificationPipelineOptions,
  ): Promise<RepoBuildState>;
  buildStateFromResult?(
    input: VerificationInput,
    result: VerificationResult,
    params: { phase: "before" | "after"; capturedAt?: string },
  ): RepoBuildState;
  compareBuildStates?(params: {
    before?: RepoBuildState;
    after: RepoBuildState;
  }): RepoBuildStateComparison;
  persistRecord?(record: VerificationRecord): Promise<void>;
  loadRecord?(recordId: string): Promise<VerificationRecord | undefined>;
  loadLatestRecord?(
    workspaceId: string,
  ): Promise<VerificationRecord | undefined>;
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
  /**
   * Optional published RepoGraph port. When present, follow_evidence and
   * discover_and_plan collect hop-1 mustRead/affected reports before drafting.
   * Omitting leaves those fields empty.
   */
  repoGraphs?: RepositoryGraphPort;
  /** Defaults to policy DEFAULT_TOOL_DEFINITIONS when omitted. */
  toolDefinitions?: readonly ModelToolDefinition[];
  /**
   * Opt-in checklist auto-advance after successful built-in mutating tools
   * (`DEFAULT_MUTATION_TOOL_DEFINITIONS`: apply_patch, write/delete/move, …).
   * Defaults to false at the engine/SDK compose layer. Host apps may enable
   * it by default; custom/MCP tools are not included unless added to the
   * engine mutating-tool set later.
   */
  taskListAutoAdvance?: boolean;
  clock?: AgentEngineClockPort;
  idGenerator?: AgentEngineIdGeneratorPort;
}

export type { ToolApprovalToken };
