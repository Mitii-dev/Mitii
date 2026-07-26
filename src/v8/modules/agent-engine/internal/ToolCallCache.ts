import type { ToolResult } from "../../tool-runtime";

/**
 * Idempotency cache for completed tool calls within a single run.
 * Resume (Phase 8) will persist this; Phase 7 keeps it in-memory.
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
}
