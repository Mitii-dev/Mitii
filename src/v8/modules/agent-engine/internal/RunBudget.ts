import type { AgentRunBudget } from "../contracts";

export class RunBudgetTracker {
  private modelCalls = 0;
  private toolCalls = 0;
  private loopIterations = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly startedMs: number;

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
  ) {
    this.startedMs = startedMs;
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
    if (Date.now() - this.startedMs >= this.limits.maxWallTimeMs) {
      return "wall_time";
    }
    return false;
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
  } {
    return {
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      loopIterations: this.loopIterations,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}
