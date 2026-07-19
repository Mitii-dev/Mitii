import type { JsonSchema } from '../shared/json';

export type ToolRisk = 'read' | 'write' | 'network' | 'destructive' | 'unknown';

export interface ValidationResult<TValue> {
  success: boolean;
  value?: TValue;
  error?: string;
}

export interface InputValidator<TInput> {
  validate(input: unknown): ValidationResult<TInput>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  skipped?: boolean;
}

export interface ToolDescriptor {
  id: string;
  displayName?: string;
  description: string;
  owner: string;
  source: 'builtin' | 'mcp' | 'installed-plugin';
  risk: ToolRisk;
  capabilities: readonly string[];
  inputSchema: JsonSchema;
}

export interface ToolContribution<TInput = unknown> {
  descriptor: ToolDescriptor;
  validator?: InputValidator<TInput>;
  execute(input: TInput): Promise<ToolResult>;
}

/**
 * A tool whose construction needs session/workspace-scoped services (a database handle, an
 * ignore-file service, a live accessor for the current turn's mode, etc.) that only exist once a
 * workspace is open — not at feature-registration time. `TServices` is intentionally generic and
 * left to the composing edition (e.g. `features/ce` defines its own session services shape); this
 * contract only prescribes when construction happens, not what a session contains.
 */
export interface ToolFactoryContribution<TInput = unknown, TServices = unknown> {
  id: string;
  owner: string;
  create(services: TServices): ToolContribution<TInput>;
}
