/**
 * VS Code thin re-export — implementation lives in `@mitii/mcp`.
 */
export {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  createBuiltinMcpCatalog,
  createBuiltinMcpServers,
  isMcpBuiltinId,
  getBuiltinCatalogEntry,
  getBuiltinCatalogMeta,
  applyBuiltinSecrets,
  validateBuiltinSecrets,
  type McpBuiltinId,
  type McpCatalogCategory,
  type McpCatalogMeta,
  type McpCatalogSecretField,
} from '@mitii/mcp';
