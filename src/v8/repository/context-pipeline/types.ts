import type {
  AgentMode,
} from "../../interaction-mode/types";

import type {
  ChunkKind,
} from "../chunking/types";

import type {
  ContextAssemblyInput,
  ContextAssemblyResult,
} from "../context-assembly/types";

import type {
  ContextSelectionBreadth,
  ContextSelectionBudget,
  ContextSelectionInput,
  ContextSelectionReferences,
  ContextSelectionResult,
} from "../context-selection/types";

import type {
  HybridRetrievalInput,
  HybridRetrievalResult,
} from "../hybrid-retrieval/types";

import type {
  RepoGraph,
} from "../repo-graph/types";

import type {
  RepoMap,
} from "../repo-map/types";

import type {
  WorkspaceSnapshot,
} from "../workspace/types";

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
