import { createBuiltinToolRegistry } from "../actions/handlers";
import { ToolRuntimeError } from "../contracts";
import type {
  ToolCapabilityDescriptor,
  ToolInvocationInput,
  ToolResult,
  ToolRuntimePorts,
} from "../contracts";
import { fingerprintToolCall, MutationTransactionRegistry } from "../internal/mutation";
import { SessionBudget } from "../internal/SessionBudget";
import type { ToolRegistry } from "../internal/ToolRegistry";
import type { ToolExecutionResult } from "../internal/ToolRegistry";
import {
  buildFinishedResult,
  mapExecutionError,
} from "./helpers/buildToolResult";
import { parseInvocation, preflightToolCall } from "./helpers";
import type {
  CallClock,
  ToolExecuteOptions,
  ToolRuntimePipelineOptions,
} from "./types";

export type { ToolExecuteOptions, ToolRuntimePipelineOptions } from "./types";

/**
 * Re-exported so the module root barrel can expose it without reaching
 * into `internal/` directly (architecture boundary requires public
 * facade files, not internal paths, in `index.ts`).
 */
export { fingerprintToolCall };

export interface RollbackMutationInput {
  checkpointId: string;
}

/**
 * Tool Runtime facade.
 *
 * Flow:
 *   parse input
 *   → begin session budget
 *   → preflight (registry + grant + approval + args)
 *   → execute registered handler
 *   → finish result / map error
 */
export class ToolRuntimePipeline {
  private readonly ports: ToolRuntimePorts;
  private readonly registry: ToolRegistry;
  private readonly transactions: MutationTransactionRegistry;

  constructor(
    ports: ToolRuntimePorts,
    options: ToolRuntimePipelineOptions = {},
  ) {
    if (!ports.fileSystem || !ports.process) {
      throw new ToolRuntimeError(
        "misconfigured_ports",
        "ToolRuntimePipeline requires fileSystem and process ports.",
      );
    }
    this.ports = ports;
    this.registry = options.registry ?? createBuiltinToolRegistry();
    this.transactions = new MutationTransactionRegistry();
  }

  public createBudget(grant: ToolInvocationInput["grant"]): SessionBudget {
    return new SessionBudget(grant);
  }

  public listCapabilities(): ToolCapabilityDescriptor[] {
    return this.registry.listCapabilities();
  }

  /** True when a host SearchPort is injected (required for web_search). */
  public hasSearchPort(): boolean {
    return this.ports.search !== undefined;
  }

  /** True when a host DiagnosticsPort is injected. */
  public hasDiagnosticsPort(): boolean {
    return this.ports.diagnostics !== undefined;
  }

  public async execute(
    input: ToolInvocationInput,
    options: ToolExecuteOptions = {},
  ): Promise<ToolResult> {
    const clock: CallClock = {
      startedAt: new Date(),
      startedMs: Date.now(),
    };

    const parsed = parseInvocation(input);
    const budget = options.budget ?? new SessionBudget(parsed.grant);

    const preflight = preflightToolCall({
      parsed,
      options,
      budget,
      registry: this.registry,
      clock,
    });
    if (!preflight.ok) {
      return preflight.result;
    }

    const { registered, maxOutputBytes, argumentsValue } = preflight;

    try {
      const executed = await registered.execute({
        arguments: argumentsValue,
        grant: parsed.grant,
        workspaceRoot: parsed.workspaceRoot,
        ports: this.ports,
        timeoutMs: registered.definition.timeoutMs,
        maxOutputBytes,
        maxContentChars: options.maxContentChars,
        signal: options.signal,
        transactions: this.transactions,
        dirtyPaths: options.dirtyPaths,
        alreadyMutatedPaths: options.alreadyMutatedPaths,
      });

      return buildFinishedResult({
        parsed,
        clock,
        budget,
        body: toResultBody(executed),
      });
    } catch (error) {
      return mapExecutionError({ error, parsed, clock });
    }
  }

  /**
   * Restore a prior mutation checkpoint. Only files in the checkpoint are
   * touched — user edits outside the transaction are preserved.
   */
  public async rollbackMutation(
    input: RollbackMutationInput,
  ): Promise<ToolResult> {
    const clock: CallClock = {
      startedAt: new Date(),
      startedMs: Date.now(),
    };
    const synthetic: ToolInvocationInput = {
      schemaVersion: 1,
      callId: `rollback_${input.checkpointId}`,
      toolName: "apply_patch",
      arguments: {},
      grant: {
        maximumWorkspaceEffect: "write",
        allowedTools: ["apply_patch"],
        allowedEffects: ["workspace_write"],
        pathScopes: ["."],
        approvalMode: "never",
        limits: {
          maxToolCalls: 1,
          maxWallTimeMs: 60_000,
          maxOutputBytes: 64_000,
        },
      },
      workspaceRoot: ".",
    };

    try {
      const restored = await this.transactions.rollback({
        checkpointId: input.checkpointId,
        fileSystem: this.ports.fileSystem,
      });
      return buildFinishedResult({
        parsed: synthetic,
        clock,
        budget: new SessionBudget(synthetic.grant),
        body: {
          status: "succeeded",
          truncated: false,
          redacted: false,
          output: {
            checkpointId: input.checkpointId,
            restoredFiles: restored,
          },
          warnings: [],
        },
      });
    } catch (error) {
      return mapExecutionError({ error, parsed: synthetic, clock });
    }
  }

  public commitMutation(checkpointId: string): void {
    this.transactions.commit(checkpointId);
  }
}

function toResultBody(executed: ToolExecutionResult) {
  if (executed.timedOut) {
    return {
      status: "timed_out" as const,
      reasonCode: "timeout" as const,
      truncated: executed.truncated,
      redacted: executed.redacted,
      output: executed.output,
      warnings: executed.warnings ?? [],
      argv: executed.argv,
      path: executed.path,
    };
  }

  if (executed.cancelled) {
    return {
      status: "cancelled" as const,
      reasonCode: "cancelled" as const,
      truncated: executed.truncated,
      redacted: executed.redacted,
      output: executed.output,
      warnings: executed.warnings ?? [],
      argv: executed.argv,
      path: executed.path,
    };
  }

  return {
    status: "succeeded" as const,
    reasonCode: executed.truncated ? ("output_truncated" as const) : undefined,
    truncated: executed.truncated,
    redacted: executed.redacted,
    output: executed.output,
    warnings: [
      ...(executed.truncated
        ? ["Tool output was truncated to grant/tool limits."]
        : []),
      ...(executed.warnings ?? []),
    ],
    argv: executed.argv,
    path: executed.path,
  };
}
