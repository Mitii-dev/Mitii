import type { ToolContribution, ToolDescriptor, ToolRisk as PluginToolRisk } from '../../interfaces/tools';
import type { JsonSchema } from '../../interfaces/shared/json';
import type { Tool, ToolRisk as LegacyToolRisk } from './types';
import { zodSchemaToParameters } from './toolSchema';

/**
 * Coarse, best-effort mapping from the legacy three-tier risk scale to the plugin contract's
 * five-tier scale. The legacy scale never distinguished "touches the network" from "mutates the
 * workspace" from "irreversible" — callers that need precise risk categorization for a specific
 * tool should override `descriptor.risk` after wrapping rather than rely on this default.
 */
function mapLegacyRisk(risk: LegacyToolRisk): PluginToolRisk {
  switch (risk) {
    case 'low':
      return 'read';
    case 'medium':
      return 'write';
    case 'high':
      return 'destructive';
  }
}

/**
 * Wraps an existing `kernel/tools` `Tool` (zod-schema, name/description/execute) as a
 * `ToolContribution` (JSON-schema descriptor, owner, capabilities) without re-implementing the
 * tool itself — the real schema validation and `execute` logic stay exactly as they are today.
 */
export function toToolContribution<TInput>(tool: Tool<TInput>, owner: string): ToolContribution<TInput> {
  const descriptor: ToolDescriptor = {
    id: tool.name,
    description: tool.description,
    owner,
    source: 'builtin',
    risk: mapLegacyRisk(tool.risk),
    capabilities: [],
    // zod-to-json-schema output is always JSON-serializable; the library's return type is looser
    // (Record<string, unknown>) than our internal JsonSchema, so this boundary cast is safe.
    inputSchema: (tool.parametersJsonSchema ?? zodSchemaToParameters(tool.inputSchema)) as JsonSchema,
  };

  return {
    descriptor,
    validator: {
      validate: (input: unknown) => {
        const result = tool.inputSchema.safeParse(input);
        return result.success
          ? { success: true, value: result.data }
          : { success: false, error: result.error.message };
      },
    },
    execute: (input: TInput) => tool.execute(input),
  };
}
