import type { ToolGrantLimits } from "./contracts/output/ToolGrant";

export const DEFAULT_TOOL_GRANT_LIMITS: ToolGrantLimits = {
  maxToolCalls: 64,
  maxWallTimeMs: 900_000,
  maxOutputBytes: 512_000,
  maxConcurrentTools: 1,
};

export const DEFAULT_READ_ONLY_TOOL_GRANT_LIMITS: ToolGrantLimits = {
  maxToolCalls: 48,
  maxWallTimeMs: 900_000,
  maxOutputBytes: 256_000,
  maxConcurrentTools: 1,
};

export const DEFAULT_NONE_TOOL_GRANT_LIMITS: ToolGrantLimits = {
  maxToolCalls: 0,
  maxWallTimeMs: 0,
  maxOutputBytes: 0,
  maxConcurrentTools: 0,
};
