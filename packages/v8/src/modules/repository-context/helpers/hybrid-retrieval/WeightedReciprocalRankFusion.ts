import {
  HYBRID_RETRIEVAL_IDS,
} from "./constants";

import {
  hybridRetrievalCandidateSchema,
} from "./schema";

import {
  RetrievalCandidateKeyBuilder,
} from "./RetrievalCandidateKeyBuilder";

import type {
  HybridRetrievalCandidate,
  MutableRetrievalFusionCandidate,
  RetrievalCandidate,
  RetrievalContribution,
  RetrievalFusionInput,
  RetrievalFusionResult,
  RetrievalReason,
} from "./types";

export class WeightedReciprocalRankFusion {
  public readonly id =
    HYBRID_RETRIEVAL_IDS.RRF;

  constructor(
    private readonly keyBuilder =
      new RetrievalCandidateKeyBuilder(),
  ) {}

  public fuse(
    input: RetrievalFusionInput,
  ): RetrievalFusionResult {
    const accumulators =
      new Map<
        string,
        MutableRetrievalFusionCandidate
      >();

    let inputCandidates = 0;
    const maximumRawScore =
      input.sourceResults.reduce(
        (sum, result) =>
          sum +
          result.sourceWeight /
            (
              input.rankConstant +
              1
            ),
        0,
      );

    for (
      const sourceResult of
        input.sourceResults
    ) {
      const sourceKeys =
        new Set<string>();

      for (
        let index = 0;
        index <
        sourceResult
          .candidates.length;
        index += 1
      ) {
        const candidate =
          sourceResult
            .candidates[index];

        if (!candidate) {
          continue;
        }

        inputCandidates += 1;

        const key =
          this.keyBuilder
            .build(candidate);

        if (
          sourceKeys.has(key)
        ) {
          continue;
        }

        sourceKeys.add(key);

        const sourceRank =
          index + 1;
        const reciprocalRankScore =
          sourceResult.sourceWeight /
          (
            input.rankConstant +
            sourceRank
          );

        const contribution:
          RetrievalContribution = {
            sourceId:
              sourceResult.sourceId,
            sourceRank,
            sourceScore:
              candidate.sourceScore,
            sourceWeight:
              sourceResult
                .sourceWeight,
            reciprocalRankScore,
            reasons:
              [...candidate.reasons],
          };

        const existing =
          accumulators.get(key);

        if (!existing) {
          accumulators.set(
            key,
            {
              key,
              candidate:
                this.cloneCandidate(
                  candidate,
                ),
              rawFusionScore:
                reciprocalRankScore,
              contributions: [
                contribution,
              ],
              reasons:
                [...candidate.reasons],
            },
          );
          continue;
        }

        existing.rawFusionScore +=
          reciprocalRankScore;
        existing.contributions.push(
          contribution,
        );
        existing.candidate =
          this.mergeCandidate(
            existing.candidate,
            candidate,
          );
        existing.reasons =
          this.mergeReasons(
            existing.reasons,
            candidate.reasons,
          );
      }
    }

    const candidates = [
      ...accumulators.values(),
    ].map(
      (accumulator) =>
        this.toOutputCandidate(
          accumulator,
          maximumRawScore,
        ),
    );

    this.sortCandidates(
      candidates,
    );

    /*
     * Every repeated canonical candidate is collapsed, whether the
     * duplicate originated inside one source or across multiple sources.
     */
    const duplicateCandidatesRemoved =
      Math.max(
        0,
        inputCandidates -
          candidates.length,
      );

    return {
      candidates:
        candidates.slice(
          0,
          input.maximumResults,
        ),
      inputCandidates,
      uniqueCandidates:
        candidates.length,
      duplicateCandidatesRemoved,
      truncated:
        candidates.length >
        input.maximumResults,
    };
  }

  private toOutputCandidate(
    accumulator:
      MutableRetrievalFusionCandidate,
    maximumRawScore: number,
  ): HybridRetrievalCandidate {
    const candidate =
      accumulator.candidate;

    const fusedScore =
      maximumRawScore > 0
        ? this.clamp(
            accumulator
              .rawFusionScore /
              maximumRawScore,
          )
        : 0;

    const output:
      HybridRetrievalCandidate = {
        key:
          accumulator.key,
        entityKind:
          candidate.entityKind,
        rootId:
          candidate.rootId,
        relativePath:
          candidate.relativePath,
        ...(candidate.chunkId
          ? {
              chunkId:
                candidate.chunkId,
            }
          : {}),
        ...(candidate.symbolId
          ? {
              symbolId:
                candidate.symbolId,
            }
          : {}),
        ...(candidate.startLine !==
        undefined
          ? {
              startLine:
                candidate.startLine,
            }
          : {}),
        ...(candidate.endLine !==
        undefined
          ? {
              endLine:
                candidate.endLine,
            }
          : {}),
        ...(candidate.title
          ? {
              title:
                candidate.title,
            }
          : {}),
        ...(candidate.preview
          ? {
              preview:
                candidate.preview,
            }
          : {}),
        ...(candidate.contentHash
          ? {
              contentHash:
                candidate
                  .contentHash,
            }
          : {}),
        ...(candidate
          .tokenEstimate !==
        undefined
          ? {
              tokenEstimate:
                candidate
                  .tokenEstimate,
            }
          : {}),
        fusedScore,
        score:
          fusedScore,
        matchedSourceCount:
          accumulator
            .contributions
            .length,
        contributions:
          accumulator
            .contributions
            .sort(
              (left, right) =>
                left.sourceId
                  .localeCompare(
                    right.sourceId,
                  ),
            ),
        reasons:
          accumulator.reasons,
      };

    return hybridRetrievalCandidateSchema
      .parse(output) as
      HybridRetrievalCandidate;
  }

  private mergeCandidate(
    current:
      RetrievalCandidate,
    incoming:
      RetrievalCandidate,
  ): RetrievalCandidate {
    const preferred =
      incoming.sourceScore >
      current.sourceScore
        ? incoming
        : current;

    return {
      ...preferred,
      ...(current.chunkId ??
      incoming.chunkId
        ? {
            chunkId:
              current.chunkId ??
              incoming.chunkId,
          }
        : {}),
      ...(current.symbolId ??
      incoming.symbolId
        ? {
            symbolId:
              current.symbolId ??
              incoming.symbolId,
          }
        : {}),
      ...(current.startLine ??
      incoming.startLine
        ? {
            startLine:
              current.startLine ??
              incoming.startLine,
          }
        : {}),
      ...(current.endLine ??
      incoming.endLine
        ? {
            endLine:
              current.endLine ??
              incoming.endLine,
          }
        : {}),
      ...(current.title ??
      incoming.title
        ? {
            title:
              current.title ??
              incoming.title,
          }
        : {}),
      ...(current.preview ??
      incoming.preview
        ? {
            preview:
              current.preview ??
              incoming.preview,
          }
        : {}),
      ...(current.contentHash ??
      incoming.contentHash
        ? {
            contentHash:
              current
                .contentHash ??
              incoming
                .contentHash,
          }
        : {}),
      ...(current
        .tokenEstimate ??
      incoming.tokenEstimate
        ? {
            tokenEstimate:
              current
                .tokenEstimate ??
              incoming
                .tokenEstimate,
          }
        : {}),
      sourceScore:
        Math.max(
          current.sourceScore,
          incoming.sourceScore,
        ),
      reasons:
        this.mergeReasons(
          current.reasons,
          incoming.reasons,
        ),
    };
  }

  private cloneCandidate(
    candidate:
      RetrievalCandidate,
  ): RetrievalCandidate {
    return {
      ...candidate,
      reasons:
        candidate.reasons.map(
          (reason) => ({
            ...reason,
          }),
        ),
    };
  }

  private mergeReasons(
    current:
      readonly RetrievalReason[],
    incoming:
      readonly RetrievalReason[],
  ): RetrievalReason[] {
    const reasons =
      new Map<string, RetrievalReason>();

    for (
      const reason of
        [...current, ...incoming]
    ) {
      reasons.set(
        `${reason.type}\u0000${reason.evidence}`,
        {
          ...reason,
        },
      );
    }

    return [
      ...reasons.values(),
    ].sort(
      (left, right) =>
        left.type
          .localeCompare(
            right.type,
          ) ||
        left.evidence
          .localeCompare(
            right.evidence,
          ),
    );
  }

  private sortCandidates(
    candidates:
      HybridRetrievalCandidate[],
  ): void {
    candidates.sort(
      (left, right) =>
        right.score -
          left.score ||
        right.matchedSourceCount -
          left.matchedSourceCount ||
        left.key.localeCompare(
          right.key,
        ),
    );
  }

  private clamp(
    value: number,
  ): number {
    return Math.max(
      0,
      Math.min(1, value),
    );
  }
}
