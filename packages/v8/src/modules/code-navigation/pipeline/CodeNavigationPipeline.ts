import {
  CODE_NAVIGATION_SCHEMA_VERSION,
} from "../constants";
import {
  CodeNavigationError,
  codeNavigationInputSchema,
  codeNavigationResultSchema,
} from "../contracts";
import type {
  CodeNavigationInput,
  CodeNavigationLocation,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationReasonCode,
  CodeNavigationResult,
} from "../contracts";

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
      if (parsed.operation === "hover") {
        if (!("line" in parsed.query)) {
          return unavailable(parsed.operation, port, "Hover requires a caret query.");
        }
        const hover = await port.hover?.(parsed.query);
        const reasonCodes: CodeNavigationReasonCode[] = hover
          ? ["hover_resolved"]
          : ["no_locations"];
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
        const locations = (
          (await port.documentSymbols?.({
            relativePath: parsed.query.relativePath,
            ...("rootId" in parsed.query && parsed.query.rootId
              ? { rootId: parsed.query.rootId }
              : {}),
          })) ?? []
        ).slice(0, parsed.maximumLocations);
        return locationsResult(parsed.operation, port, locations, "document_symbols_resolved");
      }

      if (parsed.operation === "workspace_symbols") {
        if (!("query" in parsed.query) || !parsed.query.query) {
          return unavailable(
            parsed.operation,
            port,
            "Workspace symbols require a query.",
          );
        }
        const locations = (
          (await port.workspaceSymbols?.({
            query: parsed.query.query,
            ...("rootId" in parsed.query && parsed.query.rootId
              ? { rootId: parsed.query.rootId }
              : {}),
          })) ?? []
        ).slice(0, parsed.maximumLocations);
        return locationsResult(parsed.operation, port, locations, "workspace_symbols_resolved");
      }

      if (!("line" in parsed.query)) {
        return unavailable(parsed.operation, port, "This operation requires a caret query.");
      }

      const locations = (
        parsed.operation === "definition"
          ? await port.definition(parsed.query)
          : parsed.operation === "implementation"
            ? ((await port.implementation?.(parsed.query)) ?? [])
            : parsed.operation === "call_hierarchy"
              ? ((await port.callHierarchy?.(parsed.query)) ?? [])
              : await port.references(parsed.query)
      ).slice(0, parsed.maximumLocations);

      const resolvedCode: CodeNavigationReasonCode =
        parsed.operation === "definition"
          ? "definition_resolved"
          : parsed.operation === "implementation"
            ? "implementation_resolved"
            : parsed.operation === "call_hierarchy"
              ? "call_hierarchy_resolved"
              : "references_resolved";
      return locationsResult(parsed.operation, port, locations, resolvedCode);
    } catch (error) {
      return codeNavigationResultSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        status: "unavailable",
        operation: parsed.operation,
        provider: port.provider,
        locations: [],
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

function locationsResult(
  operation: CodeNavigationParsedInput["operation"],
  port: CodeNavigationPort,
  locations: readonly CodeNavigationLocation[],
  resolvedCode: CodeNavigationReasonCode,
): CodeNavigationResult {
  const reasonCodes: CodeNavigationReasonCode[] = locations.length
    ? [resolvedCode]
    : ["no_locations"];
  if (port.provider === "repo_graph") {
    reasonCodes.push("repo_graph_fallback");
  }
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: locations.length ? "resolved" : "empty",
    operation,
    provider: port.provider,
    locations,
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
