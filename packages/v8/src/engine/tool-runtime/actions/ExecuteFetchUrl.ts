import type { ToolGrant } from "../../../modules/decision-policy";

import type { NetworkPort } from "../contracts";
import { DEFAULT_MAX_OUTPUT_BYTES } from "../defaults";
import { validateNetworkHost } from "../internal/CommandPolicy";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

export async function executeFetchUrl(params: {
  arguments: unknown;
  grant: ToolGrant;
  network?: NetworkPort;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  /** When true, trim HTML-ish noise for documentation pages. */
  docsMode?: boolean;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
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

  const fetched = await params.network.fetch({
    url: input.url,
    method: "GET",
    timeoutMs: params.timeoutMs,
    maxBodyBytes: Math.min(params.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
    signal: params.signal,
  });

  let body = fetched.body;
  if (params.docsMode) {
    body = simplifyDocsBody(body);
  }

  const sanitized = sanitizeTextOutput(body, params.maxOutputBytes);
  const output = fetchUrlOutputSchema.parse({
    url: input.url,
    status: fetched.status,
    body: sanitized.text,
    truncated: fetched.truncated || sanitized.truncated,
  });

  return {
    output,
    truncated: output.truncated,
    redacted: sanitized.redacted,
  };
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
