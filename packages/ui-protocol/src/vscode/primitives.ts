import { z } from 'zod';

export const AgentUiModeSchema = z.enum([
  'ask',
  'plan',
  'agent',
  'review',
  'database',
]);
export type AgentUiMode = z.infer<typeof AgentUiModeSchema>;

export const AgentUiDepthSchema = z.enum(['auto', 'quick', 'deep']);
export type AgentUiDepth = z.infer<typeof AgentUiDepthSchema>;

export const AgentUiEffortSchema = z.enum(['low', 'medium', 'high']);
export type AgentUiEffort = z.infer<typeof AgentUiEffortSchema>;

/** Clubbed customer control → maps to depth + effort unless intensity overrides. */
export const AgentUiThoroughnessSchema = z.enum(['low', 'medium', 'high']);
export type AgentUiThoroughness = z.infer<typeof AgentUiThoroughnessSchema>;

export const UiNavSchema = z.enum([
  'chat',
  'history',
  'settings',
  'automations',
]);
export type UiNav = z.infer<typeof UiNavSchema>;

export const SettingsTabSchema = z.enum([
  'workspace',
  'model',
  'autocomplete',
  'modes',
  'context',
  'integrations',
  'features',
  'debug',
]);
export type SettingsTab = z.infer<typeof SettingsTabSchema>;

export const LoopBandIdSchema = z.enum(['compact', 'standard', 'wide']);
export type LoopBandId = z.infer<typeof LoopBandIdSchema>;

export const McpTransportSchema = z.enum(['stdio', 'sse', 'streamable-http']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpRuntimeStatusSchema = z.enum([
  'disabled',
  'configured',
  'ready',
  'partial',
  'error',
  'prompt_injected',
  'unsupported_runtime',
]);
export type McpRuntimeStatus = z.infer<typeof McpRuntimeStatusSchema>;

export const McpServerConfigSchema = z.object({
  /** Stable id (builtins: filesystem, github, gitea, brave-search, playwright, …). */
  id: z.string().optional(),
  name: z.string(),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  /** Prefers `enabled`; `disabled` kept for backwards compatibility. */
  enabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
  /** True for Mitii-shipped preload servers. */
  builtin: z.boolean().optional(),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpSettingsSchema = z.object({
  enabled: z.boolean(),
  servers: z.array(McpServerConfigSchema),
});
export type McpSettings = z.infer<typeof McpSettingsSchema>;

export const ContextToggleKeySchema = z.enum([
  'repoMap',
  'diagnostics',
  'gitDiff',
  'editor',
  'openTabs',
  'memory',
]);
export type ContextToggleKey = z.infer<typeof ContextToggleKeySchema>;

export const ContextTogglesSchema = z.object({
  repoMap: z.boolean(),
  diagnostics: z.boolean(),
  gitDiff: z.boolean(),
  editor: z.boolean(),
  openTabs: z.boolean(),
  memory: z.boolean(),
});
export type ContextToggles = z.infer<typeof ContextTogglesSchema>;

export const ContextPinSourceSchema = z.enum(['auto', 'user']);
export type ContextPinSource = z.infer<typeof ContextPinSourceSchema>;

export const PathSuggestionSchema = z.object({
  path: z.string(),
  kind: z.enum(['file', 'folder']),
});
export type PathSuggestion = z.infer<typeof PathSuggestionSchema>;
