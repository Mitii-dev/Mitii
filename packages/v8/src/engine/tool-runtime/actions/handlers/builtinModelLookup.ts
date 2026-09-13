import type { RuntimeModelToolDefinition } from "../../internal/modelToolDefinitions";

const lookup = new Map<string, RuntimeModelToolDefinition>();

/** Populated once after BUILTIN_TOOLS (except describe_tool) are assembled. */
export function setBuiltinModelToolLookup(
  definitions: readonly RuntimeModelToolDefinition[],
): void {
  lookup.clear();
  for (const definition of definitions) {
    lookup.set(definition.name, definition);
  }
}

export function getBuiltinModelToolDefinition(
  name: string,
): RuntimeModelToolDefinition | undefined {
  return lookup.get(name);
}
