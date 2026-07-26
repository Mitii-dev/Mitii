import type {
  AgentMode,
} from "../../../request-intake";

import type {
  ChunkKind,
  RepoGraph,
  RepoMap,
  RepositoryStateDescriptor,
  RepositoryStateReference,
  WorkspaceSnapshot,
} from "../../../repository-state/index";

import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../../internal/context-assembly/types";

import type {
  ContextSelectionBreadth,
  ContextSelectionBudget,
  ContextSelectionInput,
  ContextSelectionReferences,
  ContextSelectionResult,
} from "../../internal/context-selection/types";

import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../../internal/hybrid-retrieval/types";

/**
 * Artifacts bound to one published repository state.
 * Callers must obtain these only through state resolution — never supply them
 * independently on the public pipeline input.
 */
export interface RepositoryContextResolvedState {
  descriptor: RepositoryStateDescriptor;
  snapshot: WorkspaceSnapshot;
  repoMap?: RepoMap;
  repoGraph?: RepoGraph;
}

export type RepositoryContextStateResolveStatus =
  | "resolved"
  | "not_found"
  | "unavailable";

export type RepositoryContextStateResolveResult =
  | {
      status: "resolved";
      artifacts: RepositoryContextResolvedState;
    }
  | {
      status: "not_found";
      code: "unknown_state_token" | "workspace_mismatch";
      message: string;
    }
  | {
      status: "unavailable";
      code: "state_unavailable";
      message: string;
      descriptor: RepositoryStateDescriptor;
    };

export interface RepositoryContextStateResolverPort {
  resolve(
    reference: RepositoryStateReference,
  ): Promise<RepositoryContextStateResolveResult>;
}

export interface RepositoryContextPipelineInput {
  state: RepositoryStateReference;
  query: string;
  mode: AgentMode;

  rootIds?: readonly string[];
  folderPrefix?: string;
  filePaths?: readonly string[];
  kinds?: readonly ChunkKind[];

  maximumResults?: number;
  maximumCandidatesPerSource?: number;

  breadth?: ContextSelectionBreadth;
  references?: ContextSelectionReferences;
  selectionBudget?: ContextSelectionBudget;

  abortSignal?: AbortSignal;
}

export type RepositoryContextPipelineStatus =
  | "complete"
  | "partial"
  | "empty"
  | "cancelled"
  | "failed";

export type RepositoryContextPipelineStage =
  | "state_resolution"
  | "retrieval"
  | "selection"
  | "assembly";

export interface RepositoryContextPipelineWarning {
  stage: RepositoryContextPipelineStage;
  code: string;
  message: string;
}

export interface RepositoryContextPipelineStatistics {
  retrievedCandidates: number;
  selectedItems: number;
  assembledBlocks: number;
  droppedBlocks: number;
  usedTokens: number;
}

export interface RepositoryContextPipelineResult {
  schemaVersion: 1;

  stateToken: string;
  workspaceSnapshotId: string;
  query: string;
  mode: AgentMode;
  status: RepositoryContextPipelineStatus;

  retrieval: HybridRetrievalResult;
  selection: ContextSelectionResult;
  assembly: ContextAssemblyResult;

  warnings: RepositoryContextPipelineWarning[];
  statistics: RepositoryContextPipelineStatistics;
}

export interface RepositoryContextRetrieverPort {
  retrieve(
    input: HybridRetrievalInput,
  ): Promise<HybridRetrievalResult>;
}

export interface RepositoryContextSelectorPort {
  select(
    input: ContextSelectionInput,
  ): ContextSelectionResult;
}

export interface RepositoryContextAssemblerPort {
  assemble(
    input: ContextAssemblyInput,
  ): Promise<ContextAssemblyResult>;
}

export interface RepositoryContextPipelineDependencies {
  stateResolver: RepositoryContextStateResolverPort;
  retriever: RepositoryContextRetrieverPort;
  selector: RepositoryContextSelectorPort;
  assembler: RepositoryContextAssemblerPort;
}
