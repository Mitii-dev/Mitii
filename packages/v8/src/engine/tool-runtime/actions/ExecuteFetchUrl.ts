import type { ToolGrant } from "../../../modules/decision-policy";

import type { NetworkPort } from "../contracts";
import { DEFAULT_MAX_OUTPUT_BYTES } from "../defaults";
import { validateNetworkHost } from "../internal/CommandPolicy";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  AUTONOMOUS_FETCH_USER_AGENT,
  USER_INITIATED_FETCH_USER_AGENT,
  canFetchUrlPerRobots,
  robotsTxtUrlFor,
  RobotsDeniedError,
  type FetchIntent,
} from "../internal/RobotsPolicy";
import {
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

const DEFAULT_FETCH_WINDOW = 100_000;
const ROBOTS_TIMEOUT_MS = 8_000;
const ROBOTS_MAX_BYTES = 64_000;

export async function executeFetchUrl(params: {
  arguments: unknown;
  grant: ToolGrant;
  network?: NetworkPort;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  /** When true, trim HTML-ish noise for documentation pages. */
  docsMode?: boolean;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
  timedOut?: boolean;
}> {
  const input = fetchUrlInputSchema.parse(params.arguments);

  if (!params.grant.allowedEffects.includes("network_access")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "fetch_url" requires effect "network_access" which is not granted.',
    );
  }

  validateNetworkHost({
    url: input.url,
    networkHosts: params.grant.networkHosts,
  });

  if (!params.network) {
    throw new GrantValidationError(
      "tool_unavailable",
      'Tool "fetch_url" requires a NetworkPort adapter.',
    );
  }

  const intent: FetchIntent = input.intent ?? "autonomous";
  const userAgent =
    intent === "user"
      ? USER_INITIATED_FETCH_USER_AGENT
      : AUTONOMOUS_FETCH_USER_AGENT;

  if (intent === "autonomous") {
    try {
      await assertAutonomousFetchAllowed({
        url: input.url,
        network: params.network,
        userAgent,
        signal: params.signal,
        networkHosts: params.grant.networkHosts ?? [],
      });
    } catch (error) {
      if (error instanceof RobotsDeniedError) {
        throw new GrantValidationError("network_not_allowed", error.message);
      }
      throw error;
    }
  }

  const maxBodyBytes = Math.min(params.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);

  let fetched;
  try {
    fetched = await params.network.fetch({
      url: input.url,
      method: "GET",
      headers: { "user-agent": userAgent },
      timeoutMs: params.timeoutMs,
      maxBodyBytes,
      signal: params.signal,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ETIMEDOUT") {
      return {
        output: fetchUrlOutputSchema.parse({
          url: input.url,
          status: 0,
          body: "",
          truncated: false,
          startIndex: input.startIndex ?? 0,
        }),
        truncated: false,
        redacted: false,
        timedOut: true,
      };
    }
    throw error;
  }

  let body = fetched.body;
  if (params.docsMode) {
    body = simplifyDocsBody(body);
  }

  const startIndex = input.startIndex ?? 0;
  const windowMax = Math.min(
    input.maxLength ?? DEFAULT_FETCH_WINDOW,
    params.maxOutputBytes,
  );
  const totalLength = body.length;
  const sliced =
    startIndex >= totalLength ? "" : body.slice(startIndex, startIndex + windowMax);
  const windowTruncated = startIndex + sliced.length < totalLength;
  const sanitized = sanitizeTextOutput(sliced, params.maxOutputBytes);
  const truncated =
    fetched.truncated || sanitized.truncated || windowTruncated;

  const nextStartIndex = windowTruncated
    ? startIndex + sanitized.text.length
    : undefined;

  const output = fetchUrlOutputSchema.parse({
    url: input.url,
    status: fetched.status,
    body: sanitized.text,
    truncated,
    startIndex,
    ...(nextStartIndex !== undefined ? { nextStartIndex } : {}),
    totalLength,
  });

  return {
    output,
    truncated: output.truncated,
    redacted: sanitized.redacted,
  };
}

async function assertAutonomousFetchAllowed(params: {
  url: string;
  network: NetworkPort;
  userAgent: string;
  signal?: AbortSignal;
  networkHosts: readonly string[];
}): Promise<void> {
  const robotsUrl = robotsTxtUrlFor(params.url);
  // Robots host follows the target host; grant already validated target.
  try {
    validateNetworkHost({
      url: robotsUrl,
      networkHosts: params.networkHosts,
    });
  } catch {
    // If robots.txt host somehow fails grant (shouldn't for same host), allow.
    return;
  }

  let robotsResponse;
  try {
    robotsResponse = await params.network.fetch({
      url: robotsUrl,
      method: "GET",
      headers: { "user-agent": params.userAgent },
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBodyBytes: ROBOTS_MAX_BYTES,
      signal: params.signal,
    });
  } catch {
    // Connection issues fetching robots → deny autonomous (conservative).
    throw new RobotsDeniedError(
      `Failed to fetch robots.txt for ${params.url}; autonomous fetch blocked. Retry with intent="user" if the user explicitly requested this URL.`,
    );
  }

  if (robotsResponse.status === 401 || robotsResponse.status === 403) {
    throw new RobotsDeniedError(
      `robots.txt at ${robotsUrl} returned ${robotsResponse.status}; autonomous fetch not allowed. Use intent="user" for explicit user requests.`,
    );
  }
  if (robotsResponse.status >= 400 && robotsResponse.status < 500) {
    return;
  }
  if (robotsResponse.status < 200 || robotsResponse.status >= 300) {
    return;
  }

  if (
    !canFetchUrlPerRobots({
      robotsTxt: robotsResponse.body,
      targetUrl: params.url,
      userAgent: params.userAgent,
    })
  ) {
    throw new RobotsDeniedError(
      `robots.txt disallows autonomous fetch of ${params.url}. Use intent="user" if the user explicitly asked for this URL.`,
    );
  }
}

function simplifyDocsBody(body: string): string {
  // Lightweight HTML → text for documentation fetches (not a full browser).
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
