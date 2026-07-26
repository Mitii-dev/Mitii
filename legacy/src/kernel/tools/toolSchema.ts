import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from './types';
import type { ToolDefinition } from '../llm/toolTypes';

export function zodSchemaToParameters(schema: Tool['inputSchema']): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    target: 'openApi3',
    $refStrategy: 'none',
  });
  const { $schema: _schema, ...parameters } = jsonSchema as Record<string, unknown>;
  return parameters;
}

export function toolToDefinition(tool: Tool): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersJsonSchema ?? zodSchemaToParameters(tool.inputSchema),
    },
  };
}

export function toolsToDefinitions(tools: Tool[]): ToolDefinition[] {
  return tools.map(toolToDefinition);
}
