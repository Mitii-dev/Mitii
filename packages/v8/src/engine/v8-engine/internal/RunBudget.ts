import type { AgentRunBudget } from "../contracts";
import { stripPathRangeSuffix } from "../modules/tool-content-paths";
import { DEFAULT_SAME_PATH_READ_ALLOWANCE } from "../actions/isExplorationRereadHeavy";

export class RunBudgetTracker {
  private modelCalls = 0;
  private toolCalls = 0;
  private loopIterations = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheHitTokens = 0;
  private cacheMissTokens = 0;
  private fileReadCalls = 0;
  private readonly touchedFilePaths = new Set<string>();
  private readonly readsPerBasePath = new Map<string, number>();
  private readonly startedMs: number;
  /** Wall-clock time spent waiting on user (approval/clarification) — not billed. */
  private excludedWaitMs: number;

  constructor(
    private readonly limits: AgentRunBudget,
    startedMs: number = Date.now(),
    initialUsage?: {
      modelCalls?: number;
      toolCalls?: number;
      loopIterations?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheHitTokens?: number;
      cacheMissTokens?: number;
    },
    excludedWaitMs: number = 0,
  ) {
    this.startedMs = startedMs;
    this.excludedWaitMs = Math.max(0, excludedWaitMs);
    this.modelCalls = initialUsage?.modelCalls ?? 0;
    this.toolCalls = initialUsage?.toolCalls ?? 0;
    this.loopIterations = initialUsage?.loopIterations ?? 0;
    this.inputTokens = initialUsage?.inputTokens ?? 0;
    this.outputTokens = initialUsage?.outputTokens ?? 0;
    this.cacheHitTokens = initialUsage?.cacheHitTokens ?? 0;
    this.cacheMissTokens = initialUsage?.cacheMissTokens ?? 0;
  }

  public recordModelCall(): void {
    this.modelCalls += 1;
  }

  public recordToolCall(): void {
    this.toolCalls += 1;
  }

  public recordLoopIteration(): void {
    this.loopIterations += 1;
  }

  public recordFileRead(paths: readonly string[]): void {
    this.fileReadCalls += 1;
    for (const path of paths) {
      const base = stripPathRangeSuffix(
        path
          .trim()
          .replace(/\\/g, "/")
          .replace(/\/+/g, "/")
          .replace(/^\.\//, "")
          .replace(/\/+$/, ""),
      );
      if (base.length === 0) continue;
      this.touchedFilePaths.add(base);
      this.readsPerBasePath.set(
        base,
        (this.readsPerBasePath.get(base) ?? 0) + 1,
      );
    }
  }

  public addUsage(usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
  }): void {
    if (usage?.inputTokens !== undefined) {
      this.inputTokens += usage.inputTokens;
    }
    if (usage?.outputTokens !== undefined) {
      this.outputTokens += usage.outputTokens;
    }
    if (usage?.cacheHitTokens !== undefined) {
      this.cacheHitTokens += usage.cacheHitTokens;
    }
    if (usage?.cacheMissTokens !== undefined) {
      this.cacheMissTokens += usage.cacheMissTokens;
    }
  }

  /**
   * Credit time spent suspended waiting for the user so approval latency
   * cannot exhaust wall_time before the agent finishes writing.
   */
  public addExcludedWaitMs(waitMs: number): void {
    if (waitMs > 0) {
      this.excludedWaitMs += waitMs;
    }
  }

  public getExcludedWaitMs(): number {
    return this.excludedWaitMs;
  }

  public getStartedMs(): number {
    return this.startedMs;
  }

  /** Active (non-suspended) elapsed wall time. */
  public activeElapsedMs(nowMs: number = Date.now()): number {
    return Math.max(0, nowMs - this.startedMs - this.excludedWaitMs);
  }

  public isExhausted():
    | false
    | "model_calls"
    | "tool_calls"
    | "loop_iterations"
    | "wall_time" {
    if (this.modelCalls >= this.limits.maxModelCalls) {
      return "model_calls";
    }
    if (this.toolCalls >= this.limits.maxToolCalls) {
      return "tool_calls";
    }
    if (this.loopIterations >= this.limits.maxLoopIterations) {
      return "loop_iterations";
    }
    if (this.activeElapsedMs() >= this.limits.maxWallTimeMs) {
      return "wall_time";
    }
    return false;
  }

  /**
   * Progress stall: many file reads against few unique paths.
   * Same-file windowed reads within `samePathAllowance` count as one unit.
   * Separate from the flat ceilings in `isExhausted()`.
   */
  public isExplorationStalled(params: {
    minCalls: number;
    ratio: number;
    samePathAllowance?: number;
  }): boolean {
    const unique = this.touchedFilePaths.size;
    if (unique <= 0) {
      return false;
    }
    const allowance = Math.max(
      1,
      params.samePathAllowance ?? DEFAULT_SAME_PATH_READ_ALLOWANCE,
    );
    const effective = this.effectiveFileReadCalls(allowance);
    if (effective < params.minCalls) {
      return false;
    }
    return effective >= unique * params.ratio;
  }

  private effectiveFileReadCalls(allowance: number): number {
    if (this.readsPerBasePath.size === 0) {
      return this.fileReadCalls;
    }
    let effective = 0;
    for (const count of this.readsPerBasePath.values()) {
      effective += 1 + Math.max(0, count - allowance);
    }
    return effective;
  }

  public maxModelCalls(): number {
    return this.limits.maxModelCalls;
  }

  public remainingModelCalls(): number {
    return Math.max(0, this.limits.maxModelCalls - this.modelCalls);
  }

  /**
   * `reserved` holds calls back for a later phase (verification repair).
   * The reserve is never allowed to consume the entire ceiling.
   */
  public canStartModelCall(reserved = 0): boolean {
    const reserve = Math.max(
      0,
      Math.min(reserved, Math.max(0, this.limits.maxModelCalls - 1)),
    );
    return this.modelCalls < this.limits.maxModelCalls - reserve;
  }

  public canStartToolCall(): boolean {
    return this.toolCalls < this.limits.maxToolCalls;
  }

  public snapshot(): {
    modelCalls: number;
    toolCalls: number;
    loopIterations: number;
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    fileReadCalls: number;
    uniqueFilePathsTouched: number;
    /** Thrash metric: unique paths + extras beyond same-path allowance. */
    effectiveFileReadCalls: number;
  } {
    return {
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      loopIterations: this.loopIterations,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheHitTokens: this.cacheHitTokens,
      cacheMissTokens: this.cacheMissTokens,
      fileReadCalls: this.fileReadCalls,
      uniqueFilePathsTouched: this.touchedFilePaths.size,
      effectiveFileReadCalls: this.effectiveFileReadCalls(
        DEFAULT_SAME_PATH_READ_ALLOWANCE,
      ),
    };
  }
}
