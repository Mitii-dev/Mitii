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
      "Fetch an http(s) URL allowed by grant.networkHosts. Returns status and body (size-capped).",
    inputSchema: fetchUrlInputSchema,
    outputSchema: fetchUrlOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL." },
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
