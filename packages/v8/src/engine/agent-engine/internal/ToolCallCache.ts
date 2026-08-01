import type { ToolResult } from "../../tool-runtime";

/**
 * Idempotency cache for completed tool calls within a single run.
 * Persisted across resume via entries().
 */
export class ToolCallCache {
  private readonly completed = new Map<string, ToolResult>();

  public get(callId: string): ToolResult | undefined {
    return this.completed.get(callId);
  }

  public set(callId: string, result: ToolResult): void {
    this.completed.set(callId, result);
  }

  public has(callId: string): boolean {
    return this.completed.has(callId);
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
