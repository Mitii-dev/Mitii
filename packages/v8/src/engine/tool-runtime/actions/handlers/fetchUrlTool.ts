import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFetchUrl } from "../ExecuteFetchUrl";

export const fetchUrlTool: RegisteredTool = {
  definition: defineTool({
    name: "fetch_url",
    effects: ["network_access"],
    backend: "local",
    status: "available",
    description:
      "Fetch an http(s) URL allowed by grant.networkHosts. Returns a size-capped body window; when truncated, call again with startIndex=nextStartIndex. Default intent=autonomous respects robots.txt; set intent=user only when the user explicitly requested the URL.",
    inputSchema: fetchUrlInputSchema,
    outputSchema: fetchUrlOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL." },
        startIndex: {
          type: "integer",
          minimum: 0,
          description:
            "Character offset into the body for continuation (use nextStartIndex from a prior truncated result).",
        },
        maxLength: {
          type: "integer",
          minimum: 1,
          description:
            "Max characters to return from startIndex. Do not pass maxBytes.",
        },
        intent: {
          type: "string",
          enum: ["autonomous", "user"],
          description:
            "autonomous (default) checks robots.txt; user skips robots for explicit user requests.",
        },
      },
      required: ["url"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    return executeFetchUrl({
      arguments: ctx.arguments,
      grant: ctx.grant,
      network: ctx.ports.network,
      timeoutMs: ctx.timeoutMs,
      maxOutputBytes: ctx.maxOutputBytes,
      signal: ctx.signal,
    });
  },
};
