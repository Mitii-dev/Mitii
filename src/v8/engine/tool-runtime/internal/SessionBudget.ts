import type { ToolGrant } from "../../../modules/decision-policy";

import type { ToolReasonCode } from "../contracts";

export class SessionBudgetError extends Error {
  public readonly reasonCode: ToolReasonCode;

  constructor(reasonCode: ToolReasonCode, message: string) {
    super(message);
    this.name = "SessionBudgetError";
    this.reasonCode = reasonCode;
  }
}

/**
 * Tracks grant limits across tool calls for one run/session.
 */
export class SessionBudget {
  private callCount = 0;
  private readonly startedAtMs: number;
  private outputBytes = 0;

  constructor(private readonly grant: ToolGrant) {
    this.startedAtMs = Date.now();
  }

  public beginCall(): void {
    if (this.callCount >= this.grant.limits.maxToolCalls) {
      throw new SessionBudgetError(
        "limit_exceeded",
        `maxToolCalls (${this.grant.limits.maxToolCalls}) exceeded.`,
      );
    }
    const elapsed = Date.now() - this.startedAtMs;
    if (elapsed > this.grant.limits.maxWallTimeMs) {
      throw new SessionBudgetError(
        "limit_exceeded",
        `maxWallTimeMs (${this.grant.limits.maxWallTimeMs}) exceeded.`,
      );
    }
    this.callCount += 1;
  }

  public recordOutputBytes(bytes: number): void {
    this.outputBytes += bytes;
    if (this.outputBytes > this.grant.limits.maxOutputBytes) {
      throw new SessionBudgetError(
        "limit_exceeded",
        `maxOutputBytes (${this.grant.limits.maxOutputBytes}) exceeded.`,
      );
    }
  }

  public remainingOutputBytes(): number {
    return Math.max(0, this.grant.limits.maxOutputBytes - this.outputBytes);
  }

  public get stats(): {
    callCount: number;
    outputBytes: number;
    elapsedMs: number;
  } {
    return {
      callCount: this.callCount,
      outputBytes: this.outputBytes,
      elapsedMs: Date.now() - this.startedAtMs,
    };
  }
}
