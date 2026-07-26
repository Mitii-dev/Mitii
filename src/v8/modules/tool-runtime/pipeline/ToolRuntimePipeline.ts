import { createBuiltinToolRegistry } from "../actions/handlers";
import { ToolRuntimeError } from "../contracts";
import type {
  ToolCapabilityDescriptor,
  ToolInvocationInput,
  ToolResult,
  ToolRuntimePorts,
} from "../contracts";
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
 * Tool Runtime facade.
 *
 * Flow:
 *   parse input
 *   → begin session budget
 *   → preflight (registry + grant + args)
 *   → execute registered handler
 *   → finish result / map error
 */
export class ToolRuntimePipeline {
  private readonly ports: ToolRuntimePorts;
  private readonly registry: ToolRegistry;

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
  }

  public createBudget(grant: ToolInvocationInput["grant"]): SessionBudget {
    return new SessionBudget(grant);
  }

  public listCapabilities(): ToolCapabilityDescriptor[] {
    return this.registry.listCapabilities();
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

    const { registered, maxOutputBytes } = preflight;

    try {
      const executed = await registered.execute({
        arguments: parsed.arguments,
        grant: parsed.grant,
        workspaceRoot: parsed.workspaceRoot,
        ports: this.ports,
        timeoutMs: registered.definition.timeoutMs,
        maxOutputBytes,
        signal: options.signal,
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
}

function toResultBody(executed: ToolExecutionResult) {
  if (executed.timedOut) {
    return {
      status: "timed_out" as const,
      reasonCode: "timeout" as const,
      truncated: executed.truncated,
      redacted: executed.redacted,
      output: executed.output,
      warnings: [],
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
      warnings: [],
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
    warnings: executed.truncated
      ? ["Tool output was truncated to grant/tool limits."]
      : [],
    argv: executed.argv,
    path: executed.path,
  };
}
