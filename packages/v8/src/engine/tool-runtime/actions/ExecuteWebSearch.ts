import type { ToolGrant } from "../../../modules/decision-policy";

import type { SearchPort } from "../contracts";
import { sanitizeTextOutput } from "../internal/OutputSanitizer";
import {
  webSearchInputSchema,
  webSearchOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

export async function executeWebSearch(params: {
  arguments: unknown;
  grant: ToolGrant;
  search?: SearchPort;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = webSearchInputSchema.parse(params.arguments);

  if (!params.grant.allowedEffects.includes("network_access")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "web_search" requires effect "network_access" which is not granted.',
    );
  }

  if (!params.grant.allowedTools.includes("web_search")) {
    throw new GrantValidationError(
      "tool_not_allowed",
      'Tool "web_search" is not in grant.allowedTools.',
    );
  }

  if (!params.search) {
    throw new GrantValidationError(
      "tool_unavailable",
      'Tool "web_search" requires a host-injected SearchPort.',
    );
  }

  const result = await params.search.search({
    query: input.query,
    maxResults: input.maxResults ?? 5,
    signal: params.signal,
  });

  let redacted = false;
  const results = result.results.map((hit) => {
    const title = sanitizeTextOutput(hit.title, 500);
    const snippet = sanitizeTextOutput(hit.snippet, 2_000);
    redacted = redacted || title.redacted || snippet.redacted;
    return {
      title: title.text,
      url: hit.url,
      snippet: snippet.text,
      publishedAt: hit.publishedAt,
      source: hit.source,
    };
  });

  const output = webSearchOutputSchema.parse({
    query: input.query,
    results,
    truncated: result.truncated,
  });

  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > params.maxOutputBytes) {
    return {
      output: webSearchOutputSchema.parse({
        ...output,
        results: results.slice(0, Math.max(1, Math.floor(results.length / 2))),
        truncated: true,
      }),
      truncated: true,
      redacted,
    };
  }

  return { output, truncated: output.truncated, redacted };
}
