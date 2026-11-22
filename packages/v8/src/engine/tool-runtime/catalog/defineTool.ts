import { z } from "zod";

import type { ToolCapabilityDescriptor, ToolEffect } from "../contracts";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "../defaults";

export interface ToolDefinition {
  name: string;
  effects: readonly ToolEffect[];
  backend: ToolCapabilityDescriptor["backend"];
  status: ToolCapabilityDescriptor["status"];
  timeoutMs: number;
  maxOutputBytes: number;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  /**
   * JSON Schema exposed to models. Required for available tools that should
   * appear in prompts. Kept next to Zod so Agent Engine can generate
   * ModelToolDefinition from Tool Runtime without a second hand-written catalog.
   */
  modelInputSchema?: Readonly<Record<string, unknown>>;
  /** When true, tool is catalogued for negotiation but not implemented. */
  executeSupported: boolean;
}

/** Shared helper for building catalog definitions used at registration time. */
export function defineTool(
  def: Omit<ToolDefinition, "timeoutMs" | "maxOutputBytes" | "backend" | "status"> &
    Partial<
      Pick<ToolDefinition, "timeoutMs" | "maxOutputBytes" | "backend" | "status">
    >,
): ToolDefinition {
  return {
    backend: def.backend ?? "local",
    status: def.status ?? "available",
    timeoutMs: def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
    maxOutputBytes: def.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    executeSupported: def.executeSupported,
    name: def.name,
    effects: def.effects,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    modelInputSchema: def.modelInputSchema,
  };
}
