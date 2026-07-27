import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFetchUrl } from "../ExecuteFetchUrl";

export const fetchDocsTool: RegisteredTool = {
  definition: defineTool({
    name: "fetch_docs",
    effects: ["network_access"],
    backend: "local",
    status: "available",
    description:
      "Fetch a documentation URL (same networkHosts policy as fetch_url) with HTML stripped for citation-friendly text.",
    inputSchema: fetchUrlInputSchema,
    outputSchema: fetchUrlOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) documentation URL." },
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
      docsMode: true,
    });
  },
};
