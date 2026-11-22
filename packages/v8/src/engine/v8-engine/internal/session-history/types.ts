/**
 * Session History formulae and hybrid retrieval over the durable archive.
 *
 * Language:
 * - **Session History** = projected chronological conversation for a provider turn
 *   after compaction / Context Epoch cutoffs — not the full durable log.
 * - **Dual store**: durable transcript archive ≠ model-visible projection.
 *   Compaction removes turns from projection but MUST NOT delete the archive.
 * - **Cutover**: after drop, model sees checkpoint/summary/hybrid hits + recent live turns.
 *
 * Hybrid retrieve (lexical + path/locator streams, RRF fuse)
 * over the durable archive under `conversationShare` / dropped-summary budget —
 * adds query-relevant recall on top of the rolling summary.
 */

export interface SessionHistoryRecord {
  readonly id: string;
  /** Monotonic archive sequence (seq for cutover ordering). */
  readonly seq: number;
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolName?: string;
  /** Path / query locators extracted from tool args or content. */
  readonly locators: readonly string[];
  readonly archivedAtMs: number;
  /** Compaction generation that archived this record. */
  readonly compactionGeneration: number;
}

export interface SessionHistoryRetrieveHit {
  readonly record: SessionHistoryRecord;
  readonly score: number;
  readonly streams: readonly string[];
}

export interface SessionHistoryRetrieveResult {
  readonly hits: readonly SessionHistoryRetrieveHit[];
  readonly usedChars: number;
  readonly omittedCount: number;
  /** Model-visible checkpoint text (compaction checkpoint shape). */
  readonly projectionText: string | undefined;
}

export interface SessionHistoryArchivePort {
  append(records: readonly SessionHistoryRecord[]): void;
  list(): readonly SessionHistoryRecord[];
  size(): number;
  clear(): void;
}
