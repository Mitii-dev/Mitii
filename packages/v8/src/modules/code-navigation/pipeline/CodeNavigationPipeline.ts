import {
  CodeNavigationError,
  codeNavigationInputSchema,
} from "../contracts";
import type {
  CodeNavigationCallOptions,
  CodeNavigationInput,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationReasonCode,
  CodeNavigationResult,
} from "../contracts";
import {
  clampHover,
  hoverResult,
  locationsResult,
  portUnavailableResult,
  providerFailureResult,
  unavailable,
} from "../internal/buildResult";

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
    options: CodeNavigationCallOptions = {},
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
      return portUnavailableResult(parsed.operation);
    }

    try {
      throwIfAborted(options.signal);
      const callOptions: CodeNavigationCallOptions = {
        ...(options.signal ? { signal: options.signal } : {}),
      };
      const relativePath =
        "relativePath" in parsed.query ? parsed.query.relativePath : undefined;
      if (relativePath) {
        await port.prepare?.(relativePath, callOptions);
      }

      if (parsed.operation === "hover") {
        if (!("line" in parsed.query)) {
          return unavailable(parsed.operation, port, "Hover requires a caret query.");
        }
        const rawHover = await port.hover?.(parsed.query, callOptions);
        const { hover, truncated } = clampHover(rawHover);
        return hoverResult({
          operation: parsed.operation,
          port,
          hover,
          truncated,
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
          (await port.documentSymbols?.(
            {
              relativePath: parsed.query.relativePath,
              ...("rootId" in parsed.query && parsed.query.rootId
                ? { rootId: parsed.query.rootId }
                : {}),
            },
            callOptions,
          )) ?? [];
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
          (await port.workspaceSymbols?.(
            {
              query: parsed.query.query,
              ...("rootId" in parsed.query && parsed.query.rootId
                ? { rootId: parsed.query.rootId }
                : {}),
            },
            callOptions,
          )) ?? [];
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
          ? await port.definition(parsed.query, callOptions)
          : parsed.operation === "type_definition"
            ? ((await port.typeDefinition?.(parsed.query, callOptions)) ?? [])
            : parsed.operation === "implementation"
              ? ((await port.implementation?.(parsed.query, callOptions)) ?? [])
              : parsed.operation === "call_hierarchy"
                ? ((await port.callHierarchy?.(parsed.query, callOptions)) ?? [])
                : await port.references(parsed.query, callOptions);

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
      if (isAbortError(error) || options.signal?.aborted) {
        throw error instanceof Error
          ? error
          : Object.assign(new Error(String(error)), { name: "AbortError" });
      }
      return providerFailureResult({
        operation: parsed.operation,
        port,
        error,
      });
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Code navigation aborted");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "RequestLimiterAbortError")
  ) {
    return true;
  }
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}
