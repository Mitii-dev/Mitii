import { CODE_NAVIGATION_SCHEMA_VERSION } from "../constants";
import { codeNavigationResultSchema } from "../contracts";
import type {
  CodeNavigationHover,
  CodeNavigationLocation,
  CodeNavigationParsedInput,
  CodeNavigationPort,
  CodeNavigationReasonCode,
  CodeNavigationResult,
} from "../contracts";
import { DEFAULT_MAX_HOVER_CHARACTERS } from "../defaults";

const STATUS = {
  resolved: "resolved",
  empty: "empty",
  unavailable: "unavailable",
} as const satisfies Record<string, CodeNavigationResult["status"]>;

const REASON = {
  no_locations: "no_locations",
  port_unavailable: "port_unavailable",
  locations_truncated: "locations_truncated",
  hover_truncated: "hover_truncated",
  hover_resolved: "hover_resolved",
  repo_graph_fallback: "repo_graph_fallback",
  language_server_unavailable: "language_server_unavailable",
} as const satisfies Record<string, CodeNavigationReasonCode>;

const WARNING = {
  language_server_failed: "language_server_failed",
  repo_graph_unavailable: "repo_graph_unavailable",
} as const;

export function clampHover(
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

export function portUnavailableResult(
  operation: CodeNavigationParsedInput["operation"],
): CodeNavigationResult {
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: STATUS.unavailable,
    operation,
    provider: "none",
    locations: [],
    truncated: false,
    warnings: [
      {
        code: WARNING.language_server_failed,
        message: "No code-navigation port is configured.",
      },
    ],
    reasonCodes: [REASON.port_unavailable],
  });
}

export function hoverResult(params: {
  operation: CodeNavigationParsedInput["operation"];
  port: CodeNavigationPort;
  hover: CodeNavigationHover | undefined;
  truncated: boolean;
}): CodeNavigationResult {
  const reasonCodes: CodeNavigationReasonCode[] = params.hover
    ? [REASON.hover_resolved]
    : [REASON.no_locations];
  if (params.truncated) {
    reasonCodes.push(REASON.hover_truncated);
  }
  if (params.port.provider === "repo_graph") {
    reasonCodes.push(REASON.repo_graph_fallback);
  }
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: params.hover ? STATUS.resolved : STATUS.empty,
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
    : [REASON.no_locations];
  if (truncated) {
    reasonCodes.push(REASON.locations_truncated);
  }
  if (port.provider === "repo_graph") {
    reasonCodes.push(REASON.repo_graph_fallback);
  }
  return codeNavigationResultSchema.parse({
    schemaVersion: CODE_NAVIGATION_SCHEMA_VERSION,
    status: locations.length ? STATUS.resolved : STATUS.empty,
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
    status: STATUS.unavailable,
    operation,
    provider: port.provider,
    locations: [],
    truncated: false,
    warnings: [
      {
        code: fromGraph
          ? WARNING.repo_graph_unavailable
          : WARNING.language_server_failed,
        message,
      },
    ],
    reasonCodes: fromGraph
      ? [REASON.repo_graph_fallback]
      : [REASON.language_server_unavailable],
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
