import { fingerprintToolCall } from "../../tool-runtime";
import type { ToolResult } from "../../tool-runtime";

import {
  extractToolContentPaths,
  toolContentPathsOverlap,
} from "../actions/extractToolContentPaths";

const CONTENT_PREFIX = "content:";

interface ContentCacheEntry {
  result: ToolResult;
  paths: string[];
}

/**
 * Idempotency cache for completed tool calls within a single run.
 * `callId` entries avoid re-executing a call when resuming after an
 * approval gate. `content:` entries dedup identical read-only tool+args
 * issued under a new callId in the same run.
 *
 * Content entries store path metadata so mutations invalidate only
 * overlapping paths instead of wiping the entire read cache.
 */
export class ToolCallCache {
  private readonly completed = new Map<string, ToolResult>();
  private readonly contentEntries = new Map<string, ContentCacheEntry>();

  public get(callId: string): ToolResult | undefined {
    return this.completed.get(callId);
  }

  public getByContent(
    toolName: string,
    argumentsValue: unknown,
  ): ToolResult | undefined {
    return this.contentEntries.get(contentKey(toolName, argumentsValue))
      ?.result;
  }

  public set(callId: string, result: ToolResult): void {
    this.completed.set(callId, result);
  }

  public setContent(
    toolName: string,
    argumentsValue: unknown,
    result: ToolResult,
    paths?: readonly string[],
  ): void {
    const key = contentKey(toolName, argumentsValue);
    const resolvedPaths =
      paths && paths.length > 0
        ? [...paths]
        : extractToolContentPaths(toolName, argumentsValue);
    this.contentEntries.set(key, {
      result,
      paths: resolvedPaths,
    });
  }

  public has(callId: string): boolean {
    return this.completed.has(callId);
  }

  /**
   * Invalidate read-only content cache entries.
   *
   * - Omit `changedFiles` or pass an empty list → clear all content entries
     (legacy full wipe; callId entries remain).
   * - Pass changed paths → drop only entries whose stored paths overlap.
   */
  public invalidateContent(changedFiles?: readonly string[]): number {
    if (!changedFiles || changedFiles.length === 0) {
      const count = this.contentEntries.size;
      this.contentEntries.clear();
      return count;
    }

    let removed = 0;
    for (const [key, entry] of [...this.contentEntries.entries()]) {
      if (entry.paths.length === 0) {
        // Unknown path metadata — invalidate conservatively.
        this.contentEntries.delete(key);
        removed += 1;
        continue;
      }
      if (toolContentPathsOverlap(entry.paths, changedFiles)) {
        this.contentEntries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public contentSize(): number {
    return this.contentEntries.size;
  }

  public entries(): Array<[string, ToolResult]> {
    return [...this.completed.entries()];
  }

  /** Test/debug: content keys still present after path-aware invalidation. */
  public contentPaths(): string[][] {
    return [...this.contentEntries.values()].map((entry) => [...entry.paths]);
  }

  public static fromEntries(
    entries: ReadonlyArray<[string, ToolResult]>,
  ): ToolCallCache {
    const cache = new ToolCallCache();
    for (const [callId, result] of entries) {
      cache.set(callId, result);
    }
    return cache;
  }
}

export function rebaseToolResult(result: ToolResult, callId: string): ToolResult {
  return {
    ...result,
    callId,
    audit: {
      ...result.audit,
      callId,
    },
  };
}

function contentKey(toolName: string, argumentsValue: unknown): string {
  return `${CONTENT_PREFIX}${fingerprintToolCall(toolName, argumentsValue)}`;
}
