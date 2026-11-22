/**
 * Structural view types for the token meter. Hosts pass their own snapshot
 * types; anything with these fields is accepted.
 */

export interface TokenMeterContextSlice {
  id: string;
  label: string;
  tokens: number;
  /** Whether this source contributed to the last run. */
  active: boolean;
}

/** Window-budget node: output reserve, tools, usable sections, host sources. */
export interface TokenMeterContextNode {
  id: string;
  label: string;
  usedTokens: number;
  allocatedTokens?: number;
  omittedTokens?: number;
  truncatedTokens?: number;
  kind: 'output' | 'tools' | 'usable' | 'section' | 'source' | 'free';
  active: boolean;
  children?: TokenMeterContextNode[];
}

export interface TokenMeterBreakdown {
  slices: TokenMeterContextSlice[];
  tree?: TokenMeterContextNode[];
  totalTokens: number;
  contextWindow: number;
  /** Share of the window used by packed input (0–1). */
  fillRatio: number;
  estimated?: boolean;
  source?: 'host_estimate' | 'prompt_budget';
  updatedAt?: string;
}

/** One model call within the session (live during a run). */
export interface TokenMeterTurn {
  turnIndex: number;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
  truncated?: boolean;
  estimated?: boolean;
}

export interface TokenMeterUsage {
  inputTokensTotal: number;
  outputTokensTotal: number;
  sessionTotal: number;
  modelCalls: number;
  toolCalls: number;
  turnCount: number;
  lastPromptTokens: number;
  lastResponseTokens: number;
  currentTurnTotal: number;
  contextWindow: number;
  /** Cumulative prompt-cache hits when the provider reports them. */
  cacheHitTokens?: number;
  /** Cumulative prompt-cache misses (full-rate input) when reported. */
  cacheMissTokens?: number;
  live?: boolean;
  estimated?: boolean;
  durationMs?: number;
  turns?: readonly TokenMeterTurn[];
  contextBreakdown?: TokenMeterBreakdown;
}

/** Usage accumulated by a host that always tracks cache counters. */
export type TokenUsageState = TokenMeterUsage & {
  cacheHitTokens: number;
  cacheMissTokens: number;
};
