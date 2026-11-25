import { MCP_ATTACH_STAGES } from "../constants";
import {
  noopModuleLogger,
  type ModuleLoggerPort,
  type McpAttachInstruction,
} from "../contracts";
import {
  normalizeMcpServerId,
  parseRequiredMcpMentions,
  mergeRequiredMcpServerIds,
  mcpServerIdFromToolName,
  isMcpToolAttached,
  filterToolsByMcpAttach,
  withMcpAttachOnGrant,
  formatMcpAttachInstruction,
} from "./steps";

export type McpAttachPipelineDependencies = {
  log?: ModuleLoggerPort;
};

export type ResolveAttachListInput = {
  message: string;
  explicitIds?: readonly string[];
};

export type ResolveAttachListResult = {
  cleanedMessage: string;
  requiredMcpServerIds: string[];
};

/**
 * MCP attach facade.
 *
 * Typical turn flow:
 *   2-parse-mentions → 3-merge-server-ids
 *   then (elsewhere in the turn) 5-filter-tools / 6-stamp-grant / 7-format-instruction
 *
 * Does not connect MCP clients, load tools, or enforce grants (tool-runtime does).
 */
export class McpAttachPipeline {
  private readonly log: ModuleLoggerPort;

  constructor(deps: McpAttachPipelineDependencies = {}) {
    this.log = deps.log ?? noopModuleLogger;
  }

  /** Normalize one raw server id. */
  public normalizeServerId(value: string): string | undefined {
    const startedMs = Date.now();
    const id = normalizeMcpServerId(value);
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.normalizeServerId,
      durationMs: Date.now() - startedMs,
      reasonCodes: id ? [] : ["empty_after_normalize"],
      outputSummary: { id },
    });
    return id;
  }

  /**
   * Parse `@mcp:` from message, merge with host pins.
   * Prefer this for SDK start-input wiring.
   */
  public resolveAttachList(
    input: ResolveAttachListInput,
  ): ResolveAttachListResult {
    let startedMs = Date.now();
    const parsed = parseRequiredMcpMentions(input.message);
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.parseMentions,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      outputSummary: {
        mentionCount: parsed.requiredMcpServerIds.length,
        cleanedChars: parsed.cleanedMessage.length,
      },
    });

    startedMs = Date.now();
    const requiredMcpServerIds = mergeRequiredMcpServerIds(
      input.explicitIds,
      parsed.requiredMcpServerIds,
    );
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.mergeServerIds,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      inputSummary: {
        explicitCount: input.explicitIds?.length ?? 0,
        mentionCount: parsed.requiredMcpServerIds.length,
      },
      outputSummary: {
        mergedCount: requiredMcpServerIds.length,
        ids: requiredMcpServerIds,
      },
    });

    return {
      cleanedMessage: parsed.cleanedMessage,
      requiredMcpServerIds,
    };
  }

  public serverIdFromToolName(toolName: string): string | undefined {
    return mcpServerIdFromToolName(toolName);
  }

  public isToolAttached(
    toolName: string,
    requiredMcpServerIds: readonly string[] | undefined,
  ): boolean {
    const startedMs = Date.now();
    const attached = isMcpToolAttached(toolName, requiredMcpServerIds);
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.matchTool,
      durationMs: Date.now() - startedMs,
      reasonCodes: attached ? [] : ["not_attached"],
      inputSummary: {
        toolName,
        attachCount: requiredMcpServerIds?.length ?? 0,
      },
      outputSummary: { attached },
    });
    return attached;
  }

  public filterTools<T extends { name: string }>(
    tools: readonly T[],
    requiredMcpServerIds: readonly string[] | undefined,
  ): T[] {
    const startedMs = Date.now();
    const filtered = filterToolsByMcpAttach(tools, requiredMcpServerIds);
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.filterTools,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      inputSummary: {
        toolCount: tools.length,
        attachCount: requiredMcpServerIds?.length ?? 0,
      },
      outputSummary: { kept: filtered.length },
    });
    return filtered;
  }

  public stampGrant<T extends { allowedMcpServerIds?: string[] }>(
    grant: T,
    requiredMcpServerIds: readonly string[] | undefined,
  ): T {
    const startedMs = Date.now();
    const stamped = withMcpAttachOnGrant(grant, requiredMcpServerIds);
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.stampGrant,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
      outputSummary: {
        stamped: Boolean(stamped.allowedMcpServerIds?.length),
        allowedCount: stamped.allowedMcpServerIds?.length ?? 0,
      },
    });
    return stamped;
  }

  public formatInstruction(
    requiredMcpServerIds: readonly string[],
  ): McpAttachInstruction | undefined {
    const startedMs = Date.now();
    const instruction = formatMcpAttachInstruction(requiredMcpServerIds);
    this.log.stage({
      module: "mcp-attach",
      stage: MCP_ATTACH_STAGES.formatInstruction,
      durationMs: Date.now() - startedMs,
      reasonCodes: instruction ? [] : ["empty_attach_list"],
      outputSummary: {
        present: Boolean(instruction),
        attachCount: requiredMcpServerIds.length,
      },
    });
    return instruction;
  }
}
