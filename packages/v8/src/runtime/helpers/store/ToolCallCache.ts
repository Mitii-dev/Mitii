/**
 * Run-lifetime tool call cache (S11-CACHE-TOOL).
 * callId = resume/idempotency; content = readonly dedup; mutate invalidates.
 */

export interface ToolCallCacheEntry {
  toolId: string;
  ok: boolean;
  output?: unknown;
  reasonCode?: string;
  paths: string[];
}

function contentKey(toolId: string, args: unknown): string {
  try {
    return `content:${toolId}:${JSON.stringify(args ?? null)}`;
  } catch {
    return `content:${toolId}:unserializable`;
  }
}

function pathsOverlap(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const set = new Set(a.map((p) => p.replace(/\\/g, "/").toLowerCase()));
  return b.some((p) => set.has(p.replace(/\\/g, "/").toLowerCase()));
}

export class ToolCallCache {
  private readonly byCallId = new Map<string, ToolCallCacheEntry>();
  private readonly byContent = new Map<string, ToolCallCacheEntry>();

  get(callId: string): ToolCallCacheEntry | undefined {
    return this.byCallId.get(callId);
  }

  getByContent(
    toolId: string,
    args: unknown,
  ): ToolCallCacheEntry | undefined {
    return this.byContent.get(contentKey(toolId, args));
  }

  set(callId: string, entry: ToolCallCacheEntry): void {
    this.byCallId.set(callId, entry);
  }

  setContent(
    toolId: string,
    args: unknown,
    entry: ToolCallCacheEntry,
  ): void {
    this.byContent.set(contentKey(toolId, args), entry);
  }

  /**
   * Invalidate readonly content entries after mutate.
   * Empty/omitted paths → full content wipe (callId entries kept).
   */
  invalidateContent(changedPaths?: readonly string[]): number {
    if (!changedPaths || changedPaths.length === 0) {
      const count = this.byContent.size;
      this.byContent.clear();
      return count;
    }
    let removed = 0;
    for (const [key, entry] of [...this.byContent.entries()]) {
      if (entry.paths.length === 0 || pathsOverlap(entry.paths, changedPaths)) {
        this.byContent.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  contentSize(): number {
    return this.byContent.size;
  }

  callIdSize(): number {
    return this.byCallId.size;
  }

  clear(): void {
    this.byCallId.clear();
    this.byContent.clear();
  }
}

/** Get or create the run-scoped cache on the store. */
export function getOrCreateToolCallCache(store: {
  getSlice: <T>(key: string) => T | undefined;
  setSlice: (key: string, value: unknown) => void;
}): ToolCallCache {
  const existing = store.getSlice<ToolCallCache>("toolCallCache");
  if (existing instanceof ToolCallCache) return existing;
  const cache = new ToolCallCache();
  store.setSlice("toolCallCache", cache);
  return cache;
}
