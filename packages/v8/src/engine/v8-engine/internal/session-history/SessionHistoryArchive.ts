import type { ModelMessage } from "../../../../modules/model-gateway";

import type { SessionHistoryArchivePort, SessionHistoryRecord } from "./types";

/**
 * Process-local durable Session History archive (OpenCode dual-store).
 * Survives projection cutover when turns leave the model-visible window.
 */
export class InMemorySessionHistoryArchive implements SessionHistoryArchivePort {
  private readonly records: SessionHistoryRecord[] = [];
  private nextSeq = 1;
  private compactionGeneration = 0;

  public beginCompactionGeneration(): number {
    this.compactionGeneration += 1;
    return this.compactionGeneration;
  }

  public currentCompactionGeneration(): number {
    return this.compactionGeneration;
  }

  public append(records: readonly SessionHistoryRecord[]): void {
    for (const record of records) {
      this.records.push(record);
    }
  }

  /**
   * Archive dropped model messages as searchable SessionHistoryRecords.
   * OpenCode: compaction does not delete durable history.
   */
  public archiveDroppedMessages(params: {
    dropped: readonly ModelMessage[];
    nowMs: number;
    runId: string;
  }): readonly SessionHistoryRecord[] {
    if (params.dropped.length === 0) {
      return [];
    }
    const generation = this.beginCompactionGeneration();
    const created: SessionHistoryRecord[] = [];
    for (const message of params.dropped) {
      if (message.role === "system") {
        continue;
      }
      const role =
        message.role === "tool"
          ? "tool"
          : message.role === "assistant"
            ? "assistant"
            : "user";
      const toolName =
        message.role === "tool"
          ? extractToolName(message.content)
          : message.toolCalls?.[0]?.name;
      const locators = extractLocators(message);
      const content = clipContent(message.content, 4_000);
      if (!content.trim()) {
        continue;
      }
      const record: SessionHistoryRecord = {
        id: `${params.runId}_sh_${this.nextSeq}`,
        seq: this.nextSeq,
        role,
        content,
        ...(toolName ? { toolName } : {}),
        locators,
        archivedAtMs: params.nowMs,
        compactionGeneration: generation,
      };
      this.nextSeq += 1;
      created.push(record);
    }
    this.append(created);
    return created;
  }

  public list(): readonly SessionHistoryRecord[] {
    return this.records;
  }

  public size(): number {
    return this.records.length;
  }

  public clear(): void {
    this.records.length = 0;
    this.nextSeq = 1;
    this.compactionGeneration = 0;
  }
}

function clipContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head - 20;
  return `${content.slice(0, head)}\n…\n${content.slice(-Math.max(0, tail))}`;
}

function extractToolName(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { toolName?: unknown };
    return typeof parsed.toolName === "string" ? parsed.toolName : undefined;
  } catch {
    return undefined;
  }
}

function extractLocators(message: ModelMessage): string[] {
  const locators = new Set<string>();
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      locators.add(call.name);
      try {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        pushPathLike(locators, args.path);
        pushPathLike(locators, args.from);
        pushPathLike(locators, args.to);
        pushPathLike(locators, args.query);
        pushPathLike(locators, args.pattern);
        if (Array.isArray(args.paths)) {
          for (const path of args.paths) {
            pushPathLike(locators, path);
          }
        }
        if (Array.isArray(args.patches)) {
          for (const patch of args.patches) {
            if (patch && typeof patch === "object" && "path" in patch) {
              pushPathLike(locators, (patch as { path?: unknown }).path);
            }
          }
        }
      } catch {
        /* ignore bad args */
      }
    }
  }
  if (message.role === "tool") {
    try {
      const parsed = JSON.parse(message.content) as Record<string, unknown>;
      pushPathLike(locators, parsed.locator);
      if (parsed.locator && typeof parsed.locator === "object") {
        const locator = parsed.locator as Record<string, unknown>;
        pushPathLike(locators, locator.path);
        pushPathLike(locators, locator.query);
      }
      pushPathLike(locators, parsed.finding);
    } catch {
      /* plain text tool result */
    }
  }
  // Path-like tokens in free text.
  for (const match of message.content.matchAll(
    /(?:^|[\s"'`])((?:src|lib|app|packages|tests?)\/[\w./-]+\.[\w]+)/g,
  )) {
    if (match[1]) {
      locators.add(match[1]);
    }
  }
  return [...locators].slice(0, 24);
}

function pushPathLike(target: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 240) {
    return;
  }
  target.add(trimmed);
}
