import {
  CODE_NAVIGATION_SCHEMA_VERSION,
} from "../constants";
import {
  CodeNavigationError,
  codeNavigationInputSchema,
  codeNavigationResultSchema,
} from "../contracts";
import type {
  CodeNavigationHover,
  CodeNavigationInput,
  CodeNavigationLocation,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationReasonCode,
  CodeNavigationResult,
} from "../contracts";
import { DEFAULT_MAX_HOVER_CHARACTERS } from "../defaults";

export interface CodeNavigationPipelineDependencies {
  navigation?: CodeNavigationPort;
}

/**
 * Resolves definitions, references, and hover via an injected navigation port.
 * Does not spawn language servers or own repository indexing.
 */
export class CodeNavigationPipeline {
  constructor(
    private readonly dependencies: CodeNavigationPipelineDependencies = {},
  ) {}

  public async navigate(
    input: CodeNavigationInput,
  ): Promise<CodeNavigationResult> {
    let parsed: CodeNavigationParsedInput;
    try {
      parsed = codeNavigationInputSchema.parse(input);
    } catch (error) {
      throw new CodeNavigationError(
        "invalid_input",
        "Code navigation input failed schema validation.",
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const port = this.dependencies.navigation;
    if (!port) {
      return codeNavigationResultSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        status: "unavailable",
        operation: parsed.operation,
        provider: "none",
        locations: [],
        truncated: false,
        warnings: [
          {
            code: "language_server_failed",
            message: "No code-navigation port is configured.",
          },
        ],
        reasonCodes: ["port_unavailable"],
      });
    }

    try {
      const relativePath =
        "relativePath" in parsed.query ? parsed.query.relativePath : undefined;
      if (relativePath) {
        await port.prepare?.(relativePath);
      }

      if (parsed.operation === "hover") {
        if (!("line" in parsed.query)) {
          return unavailable(parsed.operation, port, "Hover requires a caret query.");
        }
        const rawHover = await port.hover?.(parsed.query);
        const { hover, truncated } = clampHover(rawHover);
        const reasonCodes: CodeNavigationReasonCode[] = hover
          ? ["hover_resolved"]
          : ["no_locations"];
        if (truncated) {
          reasonCodes.push("hover_truncated");
        }
        if (port.provider === "repo_graph") {
          reasonCodes.push("repo_graph_fallback");
        }
        return codeNavigationResultSchema.parse({
          schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
          status: hover ? "resolved" : "empty",
          operation: parsed.operation,
          provider: port.provider,
          locations: [],
          ...(hover ? { hover } : {}),
          truncated,
          warnings: [],
          reasonCodes,
        });
      }

      if (parsed.operation === "document_symbols") {
        if (!("relativePath" in parsed.query)) {
          return unavailable(
            parsed.operation,
            port,
            "Document symbols require a relative path.",
          );
        }
        const raw =
          (await port.documentSymbols?.({
            relativePath: parsed.query.relativePath,
            ...("rootId" in parsed.query && parsed.query.rootId
              ? { rootId: parsed.query.rootId }
              : {}),
          })) ?? [];
        return locationsResult(
          parsed.operation,
          port,
          raw,
          parsed.maximumLocations,
          "document_symbols_resolved",
        );
      }

      if (parsed.operation === "workspace_symbols") {
        if (!("query" in parsed.query) || !parsed.query.query) {
          return unavailable(
            parsed.operation,
            port,
            "Workspace symbols require a query.",
          );
        }
        const raw =
          (await port.workspaceSymbols?.({
            query: parsed.query.query,
            ...("rootId" in parsed.query && parsed.query.rootId
              ? { rootId: parsed.query.rootId }
              : {}),
          })) ?? [];
        return locationsResult(
          parsed.operation,
          port,
          raw,
          parsed.maximumLocations,
          "workspace_symbols_resolved",
        );
      }

      if (!("line" in parsed.query)) {
        return unavailable(parsed.operation, port, "This operation requires a caret query.");
      }

      const raw =
        parsed.operation === "definition"
          ? await port.definition(parsed.query)
          : parsed.operation === "type_definition"
            ? ((await port.typeDefinition?.(parsed.query)) ?? [])
            : parsed.operation === "implementation"
              ? ((await port.implementation?.(parsed.query)) ?? [])
              : parsed.operation === "call_hierarchy"
                ? ((await port.callHierarchy?.(parsed.query)) ?? [])
                : await port.references(parsed.query);

      const resolvedCode: CodeNavigationReasonCode =
        parsed.operation === "definition"
          ? "definition_resolved"
          : parsed.operation === "type_definition"
            ? "type_definition_resolved"
            : parsed.operation === "implementation"
              ? "implementation_resolved"
              : parsed.operation === "call_hierarchy"
                ? "call_hierarchy_resolved"
                : "references_resolved";
      return locationsResult(
        parsed.operation,
        port,
        raw,
        parsed.maximumLocations,
        resolvedCode,
      );
    } catch (error) {
      return codeNavigationResultSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        status: "unavailable",
        operation: parsed.operation,
        provider: port.provider,
        locations: [],
        truncated: false,
        warnings: [
          {
            code:
              port.provider === "repo_graph"
                ? "repo_graph_unavailable"
                : "language_server_failed",
            message:
              error instanceof Error ? error.message : String(error),
          },
        ],
        reasonCodes:
          port.provider === "repo_graph"
            ? ["repo_graph_fallback"]
            : ["language_server_unavailable"],
      });
    }
  }
}

function clampHover(
  hover: CodeNavigationHover | undefined,
): { hover: CodeNavigationHover | undefined; truncated: boolean } {
  if (!hover) return { hover: undefined, truncated: false };
  if (hover.contents.length <= DEFAULT_MAX_HOVER_CHARACTERS) {
    return { hover, truncated: false };
  }
  return {
    hover: {
      ...hover,
      contents: `${hover.contents.slice(0, DEFAULT_MAX_HOVER_CHARACTERS)}…`,
    },
    truncated: true,
  };
}

function locationsResult(
  operation: CodeNavigationParsedInput["operation"],
  port: CodeNavigationPort,
  raw: readonly CodeNavigationLocation[],
  maximumLocations: number,
  resolvedCode: CodeNavigationReasonCode,
): CodeNavigationResult {
  const truncated = raw.length > maximumLocations;
  const locations = truncated ? raw.slice(0, maximumLocations) : raw;
  const reasonCodes: CodeNavigationReasonCode[] = locations.length
    ? [resolvedCode]
    : ["no_locations"];
  if (truncated) {
    reasonCodes.push("locations_truncated");
  }
  if (port.provider === "repo_graph") {
    reasonCodes.push("repo_graph_fallback");
  }
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: locations.length ? "resolved" : "empty",
    operation,
    provider: port.provider,
    locations,
    truncated,
    warnings: [],
    reasonCodes,
  });
}

function unavailable(
  operation: CodeNavigationParsedInput["operation"],
  port: CodeNavigationPort,
  message: string,
): CodeNavigationResult {
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: "unavailable",
    operation,
    provider: port.provider,
    locations: [],
    truncated: false,
    warnings: [
      {
        code:
          port.provider === "repo_graph"
            ? "repo_graph_unavailable"
            : "language_server_failed",
        message,
      },
    ],
    reasonCodes:
      port.provider === "repo_graph"
        ? ["repo_graph_fallback"]
        : ["language_server_unavailable"],
  });
}
