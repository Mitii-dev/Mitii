import type { ChangeImpactParsedInput } from "../types";
import type {
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../repository-state";

export type RepoGraphProjectNode = Extract<RepoGraphNode, { kind: "project" }>;
export type ChangeImpactEdgeType = ChangeImpactParsedInput["edgeTypes"][number];
export type ChangeImpactEdge = RepoGraphEdge & { type: ChangeImpactEdgeType };
export type SeedExpansion = ChangeImpactParsedInput["seedExpansion"];

export interface ResolvedSeedNode {
  node: RepoGraphFileNode | RepoGraphSymbolNode | RepoGraphProjectNode;
  file?: RepoGraphFileNode;
}

export interface WalkVisit {
  nodeId: string;
  hop: number;
  viaEdge: ChangeImpactEdge;
  score: number;
  pathNodeIds: string[];
}

export interface ImpactAdjacencyEdge {
  nodeId: string;
  edge: ChangeImpactEdge;
}
