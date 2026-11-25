import {
  REPO_GRAPH_EDGE_PREFIX,
  REPO_GRAPH_EDGE_ORDER,
} from "./constants";

import type {
  RepoGraphEdge,
  RepoGraphEdgeAccumulatorOptions,
  RepoGraphEdgeAccumulatorResult,
  RepoGraphEdgeEvidence,
  RepoGraphEdgeInput,
  RepoGraphEdgeType,
} from "./types";

export class RepoGraphEdgeAccumulator {
  private readonly edges =
    new Map<string, RepoGraphEdge>();

  private droppedEdges = 0;

  constructor(
    private readonly options:
      RepoGraphEdgeAccumulatorOptions,
  ) {
    this.validateOptions();
  }

  public add(
    input: RepoGraphEdgeInput,
  ): boolean {
    const key = this.createKey(
      input.type,
      input.fromNodeId,
      input.toNodeId,
    );

    const existing =
      this.edges.get(key);

    if (existing) {
      existing.weight += 1;
      existing.evidenceCount += 1;

      if (
        !this.hasEquivalentEvidence(
          existing.evidence,
          input.evidence,
        ) &&
        existing.evidence.length <
          this.options
            .maximumEvidencePerEdge
      ) {
        existing.evidence.push(
          input.evidence,
        );
      }

      existing.evidenceTruncated =
        existing.evidenceCount >
        existing.evidence.length;

      return true;
    }

    if (
      this.edges.size >=
      this.options.maximumEdges
    ) {
      this.droppedEdges += 1;
      return false;
    }

    this.edges.set(key, {
      id: this.createEdgeId(
        input.type,
        input.fromNodeId,
        input.toNodeId,
      ),

      type: input.type,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      weight: 1,
      evidenceCount: 1,
      evidence: [input.evidence],
      evidenceTruncated: false,
    });

    return true;
  }

  public result():
    RepoGraphEdgeAccumulatorResult {
    return {
      edges:
        [...this.edges.values()]
          .map((edge) => ({
            ...edge,
            evidence:
              [...edge.evidence],
          }))
          .sort((left, right) =>
            this.compareEdges(
              left,
              right,
            ),
          ),

      droppedEdges:
        this.droppedEdges,

      truncated:
        this.droppedEdges > 0,
    };
  }

  private createKey(
    type: RepoGraphEdgeType,
    fromNodeId: string,
    toNodeId: string,
  ): string {
    return [
      type,
      fromNodeId,
      toNodeId,
    ].join("\u0000");
  }

  private createEdgeId(
    type: RepoGraphEdgeType,
    fromNodeId: string,
    toNodeId: string,
  ): string {
    return [
      REPO_GRAPH_EDGE_PREFIX,
      type,
      encodeURIComponent(
        fromNodeId,
      ),
      encodeURIComponent(
        toNodeId,
      ),
    ].join(":");
  }

  private hasEquivalentEvidence(
    existing:
      readonly RepoGraphEdgeEvidence[],
    candidate:
      RepoGraphEdgeEvidence,
  ): boolean {
    return existing.some(
      (evidence) =>
        evidence.source ===
          candidate.source &&
        evidence.detail ===
          candidate.detail &&
        evidence.line ===
          candidate.line,
    );
  }

  private compareEdges(
    left: RepoGraphEdge,
    right: RepoGraphEdge,
  ): number {
    return (
      REPO_GRAPH_EDGE_ORDER[
        left.type
      ] -
        REPO_GRAPH_EDGE_ORDER[
          right.type
        ] ||
      left.fromNodeId.localeCompare(
        right.fromNodeId,
      ) ||
      left.toNodeId.localeCompare(
        right.toNodeId,
      ) ||
      left.id.localeCompare(
        right.id,
      )
    );
  }

  private validateOptions(): void {
    for (const [
      name,
      value,
    ] of Object.entries(
      this.options,
    )) {
      if (
        !Number.isSafeInteger(value) ||
        value <= 0
      ) {
        throw new RangeError(
          `${name} must be a positive safe integer.`,
        );
      }
    }
  }
}

