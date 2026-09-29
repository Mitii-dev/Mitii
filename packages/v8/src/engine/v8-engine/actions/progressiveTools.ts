/**
 * Progressive tool-schema INDEX stubs — parity with agent-engine.
 * V8 hosts should import from here so the thin engine owns the surface.
 */
export {
  DESCRIBE_TOOL_NAME,
  CORE_DISCOVERY_FULL_SCHEMA_TOOL_IDS,
  CORE_MUTATION_FULL_SCHEMA_TOOL_IDS,
  FULL_SCHEMA_TOOL_IDS,
  TOOL_INDEX_INPUT_SCHEMA,
  buildFullSchemaToolIds,
  filterToolDefinitions,
  isMcpAllowedByGrant,
  isMcpToolName,
  toToolIndexDefinition,
} from "../../agent-engine/actions/filterToolDefinitions";
