import type { ToolResult } from "../../../contracts";
import type { RegisteredTool } from "../../../internal/ToolRegistry";

export type PreflightSuccess = {
  ok: true;
  registered: RegisteredTool;
  maxOutputBytes: number;
  argumentsValue: unknown;
};

export type PreflightFailure = {
  ok: false;
  result: ToolResult;
};

export type PreflightOutcome = PreflightSuccess | PreflightFailure;
