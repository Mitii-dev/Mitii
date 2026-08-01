import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  webSearchInputSchema,
  webSearchOutputSchema,
} from "../../internal/ToolCatalog";
import { executeWebSearch } from "../ExecuteWebSearch";

export const webSearchTool: RegisteredTool = {
  definition: defineTool({
    name: "web_search",
    effects: ["network_access"],
    backend: "host",
    status: "available",
    description:
      "Search the web via the host-injected search provider. Returns title, URL, snippet, and optional metadata.",
    inputSchema: webSearchInputSchema,
    outputSchema: webSearchOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeWebSearch({
      arguments: ctx.arguments,
      grant: ctx.grant,
      search: ctx.ports.search,
      maxOutputBytes: ctx.maxOutputBytes,
      signal: ctx.signal,
    });
  },
};
