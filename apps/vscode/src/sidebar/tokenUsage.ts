import type * as vscode from 'vscode';

import type {
  ContextUsageBreakdown,
  RunUsagePayload,
  TokenUsageSnapshot,
} from '../protocol.js';
import { resolveContextWindow } from './configValues.js';
import { DEFAULT_CONTEXT_WINDOW } from '../settingsFields.js';

export function emptyTokenUsage(contextWindow = DEFAULT_CONTEXT_WINDOW): TokenUsageSnapshot {
  return {
    sessionTotal: 0,
    inputTokensTotal: 0,
    outputTokensTotal: 0,
    currentTurnTotal: 0,
    currentTurnInputTokens: 0,
    currentTurnOutputTokens: 0,
    aiCallCount: 0,
    modelCalls: 0,
    toolCalls: 0,
    loopIterations: 0,
    lastPromptTokens: 0,
    lastResponseTokens: 0,
    turnCount: 0,
    contextWindow,
    estimated: true,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    turns: [],
    live: false,
  };
}

export function withResolvedUsageWindow(
  usage: TokenUsageSnapshot,
  contextWindow: number,
): TokenUsageSnapshot {
  const window = Math.max(1, contextWindow);
  const contextBreakdown = usage.contextBreakdown
    ? {
        ...usage.contextBreakdown,
        contextWindow: window,
        fillRatio: Math.min(1, usage.contextBreakdown.totalTokens / window),
      }
    : undefined;
  return {
    ...usage,
    contextWindow: window,
    ...(contextBreakdown ? { contextBreakdown } : {}),
  };
}

export interface TokenUsageTrackerDeps {
  vs: typeof vscode;
  getActiveThreadId: () => string | undefined;
  isRunActive: () => boolean;
}

/**
 * Per-thread token meter: live provisional estimates during a run, committed
 * provider/estimated totals after it. Owns all run-base bookkeeping.
 */
export class TokenUsageTracker {
  usage: TokenUsageSnapshot;
  private readonly byThread = new Map<string, TokenUsageSnapshot>();
  private pendingRunTurns: TokenUsageSnapshot['turns'] = [];
  private runBaseTurns: TokenUsageSnapshot['turns'] = [];
  private runBaseInputTokens = 0;
  private runBaseOutputTokens = 0;
  private runBaseModelCalls = 0;
  private runBaseToolCalls = 0;
  private runBaseLoopIterations = 0;
  private runBaseTurnCount = 0;

  constructor(private readonly deps: TokenUsageTrackerDeps) {
    this.usage = emptyTokenUsage();
  }

  /** Freeze the current session totals as the baseline for a new run. */
  beginRun(): void {
    this.pendingRunTurns = [];
    this.runBaseTurns = [...(this.usage.turns ?? [])];
    this.runBaseInputTokens = this.usage.inputTokensTotal;
    this.runBaseOutputTokens = this.usage.outputTokensTotal;
    this.runBaseModelCalls = this.usage.modelCalls;
    this.runBaseToolCalls = this.usage.toolCalls;
    this.runBaseLoopIterations = this.usage.loopIterations;
    this.runBaseTurnCount = this.usage.turnCount;
  }

  /** Show an estimated context fill before the first provider turn lands. */
  applyProvisionalBreakdown(
    breakdown: ContextUsageBreakdown,
    contextWindow: number,
  ): void {
    this.usage = {
      ...this.usage,
      inputTokensTotal: this.runBaseInputTokens + breakdown.totalTokens,
      outputTokensTotal: this.runBaseOutputTokens,
      sessionTotal:
        this.runBaseInputTokens +
        this.runBaseOutputTokens +
        breakdown.totalTokens,
      currentTurnTotal: breakdown.totalTokens,
      currentTurnInputTokens: breakdown.totalTokens,
      currentTurnOutputTokens: 0,
      lastPromptTokens: breakdown.totalTokens,
      lastResponseTokens: 0,
      contextWindow,
      contextBreakdown: breakdown,
      estimated: true,
      live: true,
    };
  }

  applyContextBreakdown(breakdown: ContextUsageBreakdown): void {
    this.usage = {
      ...this.usage,
      contextBreakdown: breakdown,
      contextWindow: breakdown.contextWindow,
      live: true,
    };
  }

  /** Switch the meter to a thread's cached usage (or `stored` / empty). */
  activateThread(
    threadId: string | undefined,
    stored?: TokenUsageSnapshot,
  ): void {
    const cached = threadId ? this.byThread.get(threadId) : undefined;
    this.setActiveThreadUsage(
      cached ?? stored ?? emptyTokenUsage(resolveContextWindow(this.deps.vs)),
    );
  }

  resetToEmpty(): void {
    this.setActiveThreadUsage(
      emptyTokenUsage(resolveContextWindow(this.deps.vs)),
    );
  }

  forgetThread(threadId: string): void {
    this.byThread.delete(threadId);
  }

  clearThreads(): void {
    this.byThread.clear();
  }

  setActiveThreadUsage(usage: TokenUsageSnapshot): void {
    // Bootstrap/settings refreshes must not wipe an in-flight live meter.
    if (this.deps.isRunActive() && this.usage.live) {
      this.usage = withResolvedUsageWindow(
        {
          ...this.usage,
          contextWindow: usage.contextWindow || this.usage.contextWindow,
        },
        resolveContextWindow(this.deps.vs),
      );
      return;
    }
    this.usage = withResolvedUsageWindow(
      { ...usage, live: false },
      resolveContextWindow(this.deps.vs),
    );
    this.persistThreadUsage();
  }

  persistThreadUsage(): void {
    const threadId = this.deps.getActiveThreadId();
    if (!threadId) return;
    // Durable cache is always non-live; in-memory usage keeps live.
    this.byThread.set(threadId, { ...this.usage, live: false });
  }

  recordLiveModelTurn(event: {
    turnIndex: number;
    at: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
    finishReason?: string;
    truncated?: boolean;
  }): void {
    const input = event.inputTokens ?? 0;
    const output = event.outputTokens ?? 0;
    const cacheHit = event.cacheHitTokens ?? 0;
    const cacheMiss = event.cacheMissTokens ?? 0;
    const estimated =
      event.inputTokens === undefined && event.outputTokens === undefined;
    this.pendingRunTurns = [
      ...this.pendingRunTurns,
      {
        turnIndex: this.runBaseTurns.length + this.pendingRunTurns.length,
        at: event.at,
        inputTokens: input,
        outputTokens: output,
        ...(cacheHit > 0 ? { cacheHitTokens: cacheHit } : {}),
        ...(cacheMiss > 0 ? { cacheMissTokens: cacheMiss } : {}),
        finishReason: event.finishReason,
        truncated: event.truncated,
        estimated,
      },
    ];
    const pendingInput = this.pendingRunTurns.reduce(
      (sum, t) => sum + t.inputTokens,
      0,
    );
    const pendingOutput = this.pendingRunTurns.reduce(
      (sum, t) => sum + t.outputTokens,
      0,
    );
    const pendingCacheHit = this.pendingRunTurns.reduce(
      (sum, t) => sum + (t.cacheHitTokens ?? 0),
      0,
    );
    const pendingCacheMiss = this.pendingRunTurns.reduce(
      (sum, t) => sum + (t.cacheMissTokens ?? 0),
      0,
    );
    const last = this.pendingRunTurns[this.pendingRunTurns.length - 1]!;
    const baseCacheHit = this.runBaseTurns.reduce(
      (sum, t) => sum + (t.cacheHitTokens ?? 0),
      0,
    );
    const baseCacheMiss = this.runBaseTurns.reduce(
      (sum, t) => sum + (t.cacheMissTokens ?? 0),
      0,
    );
    this.usage = {
      ...this.usage,
      inputTokensTotal: this.runBaseInputTokens + pendingInput,
      outputTokensTotal: this.runBaseOutputTokens + pendingOutput,
      sessionTotal:
        this.runBaseInputTokens +
        this.runBaseOutputTokens +
        pendingInput +
        pendingOutput,
      currentTurnTotal: pendingInput + pendingOutput,
      currentTurnInputTokens: last.inputTokens,
      currentTurnOutputTokens: last.outputTokens,
      lastPromptTokens: last.inputTokens,
      lastResponseTokens: last.outputTokens,
      cacheHitTokens: baseCacheHit + pendingCacheHit,
      cacheMissTokens: baseCacheMiss + pendingCacheMiss,
      contextWindow: resolveContextWindow(this.deps.vs),
      turns: [...this.runBaseTurns, ...this.pendingRunTurns].slice(-40),
      live: true,
    };
    this.persistThreadUsage();
  }

  recordUsage(result: {
    usage: {
      modelCalls: number;
      toolCalls: number;
      loopIterations: number;
      inputTokens?: number;
      outputTokens?: number;
    };
    durationMs: number;
    answer?: string;
  }, prompt = '', contextBreakdown?: ContextUsageBreakdown): RunUsagePayload {
    const pending = this.pendingRunTurns;
    this.pendingRunTurns = [];
    const pendingInput = pending.reduce((sum, t) => sum + t.inputTokens, 0);
    const pendingOutput = pending.reduce((sum, t) => sum + t.outputTokens, 0);

    let input = result.usage.inputTokens;
    let output = result.usage.outputTokens;
    const missingProviderTokens =
      (input === undefined || input === 0) &&
      (output === undefined || output === 0) &&
      result.usage.modelCalls > 0;
    let estimated =
      input === undefined || output === undefined || missingProviderTokens;

    if (pending.length > 0 && (pendingInput > 0 || pendingOutput > 0)) {
      input = pendingInput;
      output = pendingOutput;
      estimated = pending.some((t) => t.estimated) || estimated;
    } else {
      if (input === undefined || (missingProviderTokens && (input ?? 0) === 0)) {
        input = Math.max(1, Math.ceil(prompt.length / 4));
      }
      if (
        output === undefined ||
        (missingProviderTokens && (output ?? 0) === 0)
      ) {
        output = Math.max(0, Math.ceil((result.answer ?? '').length / 4));
      }
    }

    const turnTotal = input + output;
    const contextWindow = resolveContextWindow(this.deps.vs);

    const committedTurns =
      pending.length > 0
        ? pending
        : [
            {
              turnIndex: this.runBaseTurns.length,
              at: new Date().toISOString(),
              inputTokens: input,
              outputTokens: output,
              estimated,
            },
          ];

    // Drop provisional live appends (session turns + pending), then commit once.
    const baseTurns = this.runBaseTurns;
    const baseInput = this.runBaseInputTokens;
    const baseOutput = this.runBaseOutputTokens;
    const baseModelCalls = this.runBaseModelCalls;
    const baseToolCalls = this.runBaseToolCalls;
    const baseLoopIterations = this.runBaseLoopIterations;
    const baseTurnCount = this.runBaseTurnCount;
    this.runBaseTurns = [];
    this.runBaseInputTokens = 0;
    this.runBaseOutputTokens = 0;
    this.runBaseModelCalls = 0;
    this.runBaseToolCalls = 0;
    this.runBaseLoopIterations = 0;
    this.runBaseTurnCount = 0;

    this.usage = {
      ...this.usage,
      inputTokensTotal: baseInput + input,
      outputTokensTotal: baseOutput + output,
      sessionTotal: baseInput + baseOutput + input + output,
      currentTurnTotal: turnTotal,
      currentTurnInputTokens: input,
      currentTurnOutputTokens: output,
      aiCallCount: baseModelCalls + result.usage.modelCalls,
      modelCalls: baseModelCalls + result.usage.modelCalls,
      toolCalls: baseToolCalls + result.usage.toolCalls,
      loopIterations: baseLoopIterations + result.usage.loopIterations,
      lastPromptTokens: input,
      lastResponseTokens: output,
      turnCount: baseTurnCount + 1,
      contextWindow,
      estimated,
      durationMs: result.durationMs,
      turns: [...baseTurns, ...committedTurns].slice(-40),
      live: false,
      contextBreakdown:
        contextBreakdown ?? this.usage.contextBreakdown,
    };
    this.persistThreadUsage();
    return {
      modelCalls: result.usage.modelCalls,
      toolCalls: result.usage.toolCalls,
      loopIterations: result.usage.loopIterations,
      inputTokens: input,
      outputTokens: output,
      durationMs: result.durationMs,
    };
  }
}
