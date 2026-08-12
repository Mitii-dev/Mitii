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

      const locations = (
        parsed.operation === "definition"
          ? await port.definition(parsed.query)
          : await port.references(parsed.query)
      ).slice(0, parsed.maximumLocations);

      const reasonCodes: CodeNavigationReasonCode[] = locations.length
        ? [
            parsed.operation === "definition"
              ? "definition_resolved"
              : "references_resolved",
          ]
        : ["no_locations"];
      if (port.provider === "repo_graph") {
        reasonCodes.push("repo_graph_fallback");
      }

      return codeNavigationResultSchema.parse({
        schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
        status: locations.length ? "resolved" : "empty",
        operation: parsed.operation,
        provider: port.provider,
        locations,
        warnings: [],
        reasonCodes,
      });
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
