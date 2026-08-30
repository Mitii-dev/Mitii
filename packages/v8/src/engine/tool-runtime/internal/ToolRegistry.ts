import type { ToolGrant } from "../../../modules/decision-policy";

import type {
  ToolCapabilityDescriptor,
  ToolRuntimePorts,
} from "../contracts";
import type { MutationTransactionRegistry } from "./mutation";
import type { ToolDefinition } from "./ToolCatalog";

export interface ToolExecutionContext {
  arguments: unknown;
  grant: ToolGrant;
  workspaceRoot: string;
  ports: ToolRuntimePorts;
  timeoutMs: number;
  maxOutputBytes: number;
  /**
   * Optional model-facing content budget forwarded from WindowPolicy
   * (`toolResultContentChars`). Read tools use it to window results early.
   */
  maxContentChars?: number;
  signal?: AbortSignal;
  /** Present when Tool Runtime is configured for Phase 8 mutations. */
  transactions?: MutationTransactionRegistry;
  dirtyPaths?: readonly string[];
  alreadyMutatedPaths?: readonly string[];
}

export interface ToolExecutionResult {
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  timedOut?: boolean;
  cancelled?: boolean;
  argv?: string[];
  path?: string;
  /** Non-fatal issues surfaced alongside a successful/partial result (e.g. denied or unreadable paths). */
  warnings?: string[];
}

export type ToolHandler = (
  context: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

/**
 * One catalog entry + executor. Register new tools here instead of
 * editing ToolRuntimePipeline.
 */
export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolHandler;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  public register(tool: RegisteredTool): this {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: "${name}".`);
    }
    this.tools.set(name, tool);
    return this;
  }

  public registerAll(tools: readonly RegisteredTool[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  public get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  public listCapabilities(): ToolCapabilityDescriptor[] {
    return this.list().map((tool) => ({
      name: tool.definition.name,
      effects: [...tool.definition.effects],
      backend: tool.definition.backend,
      status: tool.definition.status,
      timeoutMs: tool.definition.timeoutMs,
      maxOutputBytes: tool.definition.maxOutputBytes,
      description: tool.definition.description,
    }));
  }
}
