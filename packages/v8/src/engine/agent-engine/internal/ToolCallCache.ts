import { fingerprintToolCall } from "../../tool-runtime";
import type { ToolResult } from "../../tool-runtime";

const CONTENT_PREFIX = "content:";

/**
 * Idempotency cache for completed tool calls within a single run.
 * `callId` entries avoid re-executing a call when resuming after an
 * approval gate. `content:` entries dedup identical read-only tool+args
 * issued under a new callId in the same run.
 */
export class ToolCallCache {
  private readonly completed = new Map<string, ToolResult>();

  public get(callId: string): ToolResult | undefined {
    return this.completed.get(callId);
  }

  public getByContent(
    toolName: string,
    argumentsValue: unknown,
  ): ToolResult | undefined {
    return this.completed.get(contentKey(toolName, argumentsValue));
  }

  public set(callId: string, result: ToolResult): void {
    this.completed.set(callId, result);
  }

  public setContent(
    toolName: string,
    argumentsValue: unknown,
    result: ToolResult,
  ): void {
    this.completed.set(contentKey(toolName, argumentsValue), result);
  }

  public has(callId: string): boolean {
    return this.completed.has(callId);
  }

  public invalidateContent(): void {
    for (const key of [...this.completed.keys()]) {
      if (key.startsWith(CONTENT_PREFIX)) {
        this.completed.delete(key);
      }
    }
  }

  public entries(): Array<[string, ToolResult]> {
    return [...this.completed.entries()];
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
