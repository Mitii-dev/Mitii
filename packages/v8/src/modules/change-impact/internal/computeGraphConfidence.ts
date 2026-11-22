import type { RepoGraph } from "../../repository-state";
import { CHANGE_IMPACT_POLICY } from "../policy";

export type GraphConfidenceAssessment = {
  confidence: number;
  note?: string;
  low: boolean;
  unsafe: boolean;
};

/**
 * Estimate how complete the published graph is for impact walks.
 * Never invents edges — unresolved / omitted / ambiguous counts lower confidence.
 */
export function computeGraphConfidence(
  graph: RepoGraph,
): GraphConfidenceAssessment {
  const stats = graph.statistics;
  const resolved =
    stats.importEdges +
    stats.callEdges +
    stats.referenceEdges +
    (stats.heritageEdges ?? 0) +
    stats.projectRelationshipEdges;

  const unresolved =
    stats.unresolvedImports +
    stats.unresolvedReferences +
    stats.omittedImportTargets +
    stats.omittedReferenceTargets +
    stats.ambiguousReferences +
    stats.droppedEdges;

  let confidence =
    resolved + unresolved === 0
      ? 1
      : Number((resolved / (resolved + unresolved)).toFixed(2));

  const notes: string[] = [];

  if (graph.status === "partial") {
    confidence = Number(Math.min(confidence, 0.65).toFixed(2));
    notes.push("graph status is partial");
  }

  if (stats.droppedEdges > 0 || stats.droppedSymbolNodes > 0) {
    confidence = Number(Math.min(confidence, confidence * 0.95).toFixed(2));
    notes.push("graph dropped edges or symbol nodes under budget");
  }

  if (unresolved > 0) {
    notes.push(
      `${unresolved} unresolved/omitted/ambiguous import or reference signal(s)`,
    );
  }

  const unsafe =
    confidence < CHANGE_IMPACT_POLICY.confidenceUnsafe ||
    (graph.status === "partial" && unresolved > 0);
  const low =
    unsafe || confidence < CHANGE_IMPACT_POLICY.confidenceLow;

  return {
    confidence,
    ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
    low,
    unsafe,
  };
}
