import type {
  AgentMode,
} from "../../../request-intake";

import type {
  ChunkKind,
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

import type {
  RepoGraph,
} from "../../../repository-state/index";

import type {
  RepoMap,
} from "../../../repository-state/index";

import type {
  WorkspaceSnapshot,
} from "../../../repository-state/index";

export interface RepositoryContextPipelineInput {
  workspace: string;
  query: string;
  mode: AgentMode;

  snapshot: WorkspaceSnapshot;

  repoMap?: RepoMap;
  repoGraph?: RepoGraph;
  codeIndexChangeToken?: string;

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
  retriever: RepositoryContextRetrieverPort;
  selector: RepositoryContextSelectorPort;
  assembler: RepositoryContextAssemblerPort;
}
