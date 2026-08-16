import type { AgentRunBudget } from "../contracts";

export class RunBudgetTracker {
  private modelCalls = 0;
  private toolCalls = 0;
  private loopIterations = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private fileReadCalls = 0;
  private readonly touchedFilePaths = new Set<string>();
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
      const normalized = path.trim().replace(/\\/g, "/");
      if (normalized.length > 0) {
        this.touchedFilePaths.add(normalized);
      }
    }
  }

  public addUsage(usage?: {
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    if (usage?.inputTokens !== undefined) {
      this.inputTokens += usage.inputTokens;
    }
    if (usage?.outputTokens !== undefined) {
      this.outputTokens += usage.outputTokens;
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
   * Separate from the flat ceilings in `isExhausted()`.
   */
  public isExplorationStalled(params: {
    minCalls: number;
    ratio: number;
  }): boolean {
    if (this.fileReadCalls < params.minCalls || this.touchedFilePaths.size <= 0) {
      return false;
    }
    return this.fileReadCalls >= this.touchedFilePaths.size * params.ratio;
  }

  public canStartModelCall(): boolean {
    return this.modelCalls < this.limits.maxModelCalls;
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
    fileReadCalls: number;
    uniqueFilePathsTouched: number;
  } {
    return {
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      loopIterations: this.loopIterations,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      fileReadCalls: this.fileReadCalls,
      uniqueFilePathsTouched: this.touchedFilePaths.size,
    };
  }
}
