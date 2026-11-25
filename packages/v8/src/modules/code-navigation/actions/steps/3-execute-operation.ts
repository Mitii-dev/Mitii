import {
  CODE_NAVIGATION_MESSAGES,
  CODE_NAVIGATION_REASON,
} from "../../constants";
import type {
  CodeNavigationCallOptions,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationReasonCode,
  CodeNavigationResult,
} from "../../types";
import {
  clampHover,
  hoverResult,
  locationsResult,
  unavailable,
} from "./4-build-result";

/**
 * Flow step 3: dispatch the validated operation to the navigation port.
 */
export async function executeCodeNavigationOperation(params: {
  port: CodeNavigationPort;
  input: CodeNavigationParsedInput;
  options: CodeNavigationCallOptions;
}): Promise<CodeNavigationResult> {
  const { port, input, options } = params;

  if (input.operation === "hover") {
    if (!("line" in input.query)) {
      return unavailable(
        input.operation,
        port,
        CODE_NAVIGATION_MESSAGES.hoverRequiresCaret,
      );
    }
    const rawHover = await port.hover?.(input.query, options);
    const { hover, truncated } = clampHover(rawHover);
    return hoverResult({
      operation: input.operation,
      port,
      hover,
      truncated,
    });
  }

  if (input.operation === "document_symbols") {
    if (!("relativePath" in input.query)) {
      return unavailable(
        input.operation,
        port,
        CODE_NAVIGATION_MESSAGES.documentSymbolsRequirePath,
      );
    }
    const raw =
      (await port.documentSymbols?.(
        {
          relativePath: input.query.relativePath,
          ...("rootId" in input.query && input.query.rootId
            ? { rootId: input.query.rootId }
            : {}),
        },
        options,
      )) ?? [];
    return locationsResult(
      input.operation,
      port,
      raw,
      input.maximumLocations,
      CODE_NAVIGATION_REASON.documentSymbolsResolved,
    );
  }

  if (input.operation === "workspace_symbols") {
    if (!("query" in input.query) || !input.query.query) {
      return unavailable(
        input.operation,
        port,
        CODE_NAVIGATION_MESSAGES.workspaceSymbolsRequireQuery,
      );
    }
    const raw =
      (await port.workspaceSymbols?.(
        {
          query: input.query.query,
          ...("rootId" in input.query && input.query.rootId
            ? { rootId: input.query.rootId }
            : {}),
        },
        options,
      )) ?? [];
    return locationsResult(
      input.operation,
      port,
      raw,
      input.maximumLocations,
      CODE_NAVIGATION_REASON.workspaceSymbolsResolved,
    );
  }

  if (!("line" in input.query)) {
    return unavailable(
      input.operation,
      port,
      CODE_NAVIGATION_MESSAGES.operationRequiresCaret,
    );
  }

  const raw =
    input.operation === "definition"
      ? await port.definition(input.query, options)
      : input.operation === "type_definition"
        ? ((await port.typeDefinition?.(input.query, options)) ?? [])
        : input.operation === "implementation"
          ? ((await port.implementation?.(input.query, options)) ?? [])
          : input.operation === "call_hierarchy"
            ? ((await port.callHierarchy?.(input.query, options)) ?? [])
            : await port.references(input.query, options);

  const resolvedCode: CodeNavigationReasonCode =
    input.operation === "definition"
      ? CODE_NAVIGATION_REASON.definitionResolved
      : input.operation === "type_definition"
        ? CODE_NAVIGATION_REASON.typeDefinitionResolved
        : input.operation === "implementation"
          ? CODE_NAVIGATION_REASON.implementationResolved
          : input.operation === "call_hierarchy"
            ? CODE_NAVIGATION_REASON.callHierarchyResolved
            : CODE_NAVIGATION_REASON.referencesResolved;

  return locationsResult(
    input.operation,
    port,
    raw,
    input.maximumLocations,
    resolvedCode,
  );
}
