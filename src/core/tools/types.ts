import { z } from 'zod';

export type ToolRisk = 'low' | 'medium' | 'high';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  /** Intentional dedup / non-fatal helper warning. */
  skipped?: boolean;
}

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema: z.ZodType<TInput>;
  parametersJsonSchema?: Record<string, unknown>;
  execute(input: TInput): Promise<ToolResult>;
}

export interface ToolCallAudit {
  toolName: string;
  input: unknown;
  result: ToolResult;
  timestamp: number;
}
