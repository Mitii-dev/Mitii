import {
  SESSION_HISTORY_POLICY,
  SESSION_HISTORY_PROJECTION_MARKERS,
} from "./policy";
import {
  buildDocFrequency,
  diversifySessionHistoryHits,
  fuseSessionHistoryStreams,
  scoreLexical,
  scoreLocatorOverlap,
  tokenizeQuery,
} from "./scoreSessionHistory";
import type {
  SessionHistoryRecord,
  SessionHistoryRetrieveHit,
  SessionHistoryRetrieveResult,
} from "./types";

export function looksReferentialSessionQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < SESSION_HISTORY_POLICY.minQueryChars) {
    return false;
  }
  return SESSION_HISTORY_POLICY.referentialPatterns.some((pattern) =>
    pattern.test(trimmed),
  );
}

export function resolveSessionHistoryProjectionBudgetChars(params: {
  conversationTokens?: number;
  droppedTurnSummaryChars?: number;
  estimatorCharsPerToken?: number;
}): number {
  const charsPerToken = params.estimatorCharsPerToken ?? 4;
  const fromConversation =
    params.conversationTokens !== undefined
      ? Math.floor(
          params.conversationTokens *
            charsPerToken *
            SESSION_HISTORY_POLICY.conversationShareFraction,
        )
      : 0;
  const fromDropped = params.droppedTurnSummaryChars ?? 0;
  const raw = Math.max(fromConversation, fromDropped);
  return Math.min(
    SESSION_HISTORY_POLICY.projectionCharsMax,
    Math.max(SESSION_HISTORY_POLICY.projectionCharsMin, raw || SESSION_HISTORY_POLICY.projectionCharsMin),
  );
}

/**
 * Hybrid retrieve over durable Session History archive.
 *
 * Streams: lexical (content) + locator/path + recency (newer archive seq).
 * Fuse with RRF; diversify by role/tool; pack under char budget into an
 * OpenCode-shaped conversation checkpoint for model projection.
 */
export function retrieveSessionHistory(params: {
  archive: readonly SessionHistoryRecord[];
  query: string;
  budgetChars: number;
  maxHits?: number;
  force?: boolean;
}): SessionHistoryRetrieveResult {
  const query = params.query.trim();
  if (
    params.archive.length === 0 ||
    query.length < SESSION_HISTORY_POLICY.minQueryChars
  ) {
    return emptyResult();
  }
  if (!params.force && !looksReferentialSessionQuery(query)) {
    // Still allow retrieve when caller forces (e.g. just after drop).
    // Without force, require referential cues to avoid noise every turn.
    return emptyResult();
  }

  const queryTokens = tokenizeQuery(query);
  if (queryTokens.length === 0) {
    return emptyResult();
  }

  const docFreq = buildDocFrequency(params.archive, queryTokens);
  const lexicalScored = params.archive
    .map((record) => ({
      id: record.id,
      score: scoreLexical(
        queryTokens,
        record,
        docFreq,
        params.archive.length,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const locatorScored = params.archive
    .map((record) => ({
      id: record.id,
      score: scoreLocatorOverlap(queryTokens, record),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const recencyRanked = [...params.archive]
    .sort((a, b) => b.seq - a.seq)
    .map((record) => record.id);

  const maxHits = params.maxHits ?? SESSION_HISTORY_POLICY.maxHits;
  const fused = fuseSessionHistoryStreams(
    [
      {
        id: "lexical",
        weight: SESSION_HISTORY_POLICY.lexicalStreamWeight,
        rankedIds: lexicalScored.map((e) => e.id),
      },
      {
        id: "locator",
        weight: SESSION_HISTORY_POLICY.locatorStreamWeight,
        rankedIds: locatorScored.map((e) => e.id),
      },
      {
        id: "recency",
        weight: SESSION_HISTORY_POLICY.recencyStreamWeight,
        rankedIds: recencyRanked,
      },
    ],
    maxHits * 3,
  );

  const byId = new Map(params.archive.map((record) => [record.id, record]));
  const diversified = diversifySessionHistoryHits(
    fused,
    (id) => {
      const record = byId.get(id);
      if (!record) {
        return "unknown";
      }
      return record.toolName ?? record.role;
    },
    maxHits,
  );

  const hits: SessionHistoryRetrieveHit[] = [];
  for (const entry of diversified) {
    const record = byId.get(entry.id);
    if (!record) {
      continue;
    }
    hits.push({
      record,
      score: entry.score,
      streams: entry.streams,
    });
  }

  return packSessionHistoryProjection({
    hits,
    budgetChars: params.budgetChars,
  });
}

function packSessionHistoryProjection(params: {
  hits: readonly SessionHistoryRetrieveHit[];
  budgetChars: number;
}): SessionHistoryRetrieveResult {
  if (params.hits.length === 0) {
    return emptyResult();
  }

  const { start, end, hitTag } = SESSION_HISTORY_PROJECTION_MARKERS;
  const lines: string[] = [
    start,
    "[session history — query-relevant prior turns recalled from durable archive]",
  ];
  let used = lines.join("\n").length;
  let omitted = 0;
  const included: SessionHistoryRetrieveHit[] = [];

  for (const hit of params.hits) {
    const body = formatHit(hit);
    const block = `<${hitTag} seq="${hit.record.seq}" role="${hit.record.role}" score="${hit.score.toFixed(2)}">\n${body}\n</${hitTag}>`;
    if (used + block.length + end.length + 2 > params.budgetChars) {
      omitted += 1;
      continue;
    }
    lines.push(block);
    used += block.length + 1;
    included.push(hit);
  }
  lines.push(end);

  if (included.length === 0) {
    return emptyResult();
  }

  return {
    hits: included,
    usedChars: used,
    omittedCount: omitted,
    projectionText: lines.join("\n"),
  };
}

function formatHit(hit: SessionHistoryRetrieveHit): string {
  const parts: string[] = [];
  if (hit.record.toolName) {
    parts.push(`tool=${hit.record.toolName}`);
  }
  if (hit.record.locators.length > 0) {
    parts.push(`locators=${hit.record.locators.slice(0, 4).join(", ")}`);
  }
  const preview = hit.record.content.replace(/\s+/g, " ").trim();
  parts.push(preview.slice(0, 600));
  return parts.join("\n");
}

function emptyResult(): SessionHistoryRetrieveResult {
  return {
    hits: [],
    usedChars: 0,
    omittedCount: 0,
    projectionText: undefined,
  };
}

/** Detect existing session-history checkpoint messages in projection. */
export function isSessionHistoryCheckpointContent(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith(SESSION_HISTORY_PROJECTION_MARKERS.start);
}
