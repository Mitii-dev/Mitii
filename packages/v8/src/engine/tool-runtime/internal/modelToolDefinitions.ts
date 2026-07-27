import type { ToolEffect } from "../contracts";
import type { RegisteredTool } from "./ToolRegistry";
import type { ToolDefinition } from "./ToolCatalog";

/**
 * JSON Schema tool definition exposed to models.
 * Shape matches ModelToolDefinition without importing model-gateway
 * (keeps Tool Runtime free of gateway coupling).
 */
export interface RuntimeModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

/**
 * Convert a registered tool definition into a model-facing schema.
 * Unavailable / stub tools are omitted so prompts never advertise dead tools.
 */
export function toModelToolDefinition(
  definition: ToolDefinition,
): RuntimeModelToolDefinition | undefined {
  if (
    !definition.executeSupported ||
    definition.status !== "available" ||
    definition.modelInputSchema === undefined
  ) {
    return undefined;
  }
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.modelInputSchema,
  };
}

export function listModelToolDefinitions(
  tools: readonly RegisteredTool[],
  options?: {
    /** When set, only include tools whose effects are a subset of this set. */
    allowedEffects?: readonly ToolEffect[];
    /** When set, require at least one of these effects. */
    requireEffect?: ToolEffect;
  },
): RuntimeModelToolDefinition[] {
  const allowed = options?.allowedEffects
    ? new Set(options.allowedEffects)
    : undefined;

  const result: RuntimeModelToolDefinition[] = [];
  for (const tool of tools) {
    const def = tool.definition;
    if (options?.requireEffect && !def.effects.includes(options.requireEffect)) {
      continue;
    }
    if (allowed) {
      const effectsOk = def.effects.every((effect) => allowed.has(effect));
      if (!effectsOk) {
        continue;
      }
    }
    const model = toModelToolDefinition(def);
    if (model) {
      result.push(model);
    }
  }
  return result;
}
