import {
  CODE_NAVIGATION_MESSAGES,
  CODE_NAVIGATION_REASON,
  CODE_NAVIGATION_SCHEMA_VERSION,
} from "../../constants";
import { codeNavigationResultSchema } from "../../contracts";
import type {
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationReasonCode,
  CodeNavigationResult,
} from "../../contracts";
import { DEFAULT_MAX_HOVER_CHARACTERS } from "../../defaults";

export function clampHover(
  hover: CodeNavigationHover | undefined,
): { hover: CodeNavigationHover | undefined; truncated: boolean } {
  if (!hover) {
    return { hover: undefined, truncated: false };
  }
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

export function portUnavailableResult(
  operation: CodeNavigationParsedInput["operation"],
): CodeNavigationResult {
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: "unavailable",
    operation,
    provider: "none",
    locations: [],
    truncated: false,
    warnings: [
      {
        code: "language_server_failed",
        message: CODE_NAVIGATION_MESSAGES.portUnavailable,
      },
    ],
    reasonCodes: [CODE_NAVIGATION_REASON.portUnavailable],
  });
}

export function hoverResult(params: {
  operation: CodeNavigationParsedInput["operation"];
  port: CodeNavigationPort;
  hover: CodeNavigationHover | undefined;
  truncated: boolean;
}): CodeNavigationResult {
  const reasonCodes: CodeNavigationReasonCode[] = params.hover
    ? [CODE_NAVIGATION_REASON.hoverResolved]
    : [CODE_NAVIGATION_REASON.noLocations];
  if (params.truncated) {
    reasonCodes.push(CODE_NAVIGATION_REASON.hoverTruncated);
  }
  if (params.port.provider === "repo_graph") {
    reasonCodes.push(CODE_NAVIGATION_REASON.repoGraphFallback);
  }
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: params.hover ? "resolved" : "empty",
    operation: params.operation,
    provider: params.port.provider,
    locations: [],
    ...(params.hover ? { hover: params.hover } : {}),
    truncated: params.truncated,
    warnings: [],
    reasonCodes,
  });
}

export function locationsResult(
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
    : [CODE_NAVIGATION_REASON.noLocations];
  if (truncated) {
    reasonCodes.push(CODE_NAVIGATION_REASON.locationsTruncated);
  }
  if (port.provider === "repo_graph") {
    reasonCodes.push(CODE_NAVIGATION_REASON.repoGraphFallback);
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

export function unavailable(
  operation: CodeNavigationParsedInput["operation"],
  port: CodeNavigationPort,
  message: string,
): CodeNavigationResult {
  const fromGraph = port.provider === "repo_graph";
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: "unavailable",
    operation,
    provider: port.provider,
    locations: [],
    truncated: false,
    warnings: [
      {
        code: fromGraph
          ? "repo_graph_unavailable"
          : "language_server_failed",
        message,
      },
    ],
    reasonCodes: fromGraph
      ? [CODE_NAVIGATION_REASON.repoGraphFallback]
      : [CODE_NAVIGATION_REASON.languageServerUnavailable],
  });
}

export function providerFailureResult(params: {
  operation: CodeNavigationParsedInput["operation"];
  port: CodeNavigationPort;
  error: unknown;
}): CodeNavigationResult {
  return unavailable(
    params.operation,
    params.port,
    params.error instanceof Error ? params.error.message : String(params.error),
  );
}
