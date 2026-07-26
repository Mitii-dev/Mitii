import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFetchUrl } from "../ExecuteFetchUrl";

/**
 * Catalogued for capability negotiation and network-grant enforcement.
 * Not executable in Phase 4 — handler validates grant then rejects.
 */
export const fetchUrlTool: RegisteredTool = {
  definition: defineTool({
    name: "fetch_url",
    effects: ["network_access"],
    backend: "local",
    status: "unavailable",
    description:
      "Fetch a URL (catalogued for capability negotiation; not granted in Phase 4).",
    inputSchema: fetchUrlInputSchema,
    outputSchema: fetchUrlOutputSchema,
    executeSupported: false,
  }),
  async execute(ctx) {
    await executeFetchUrl({
      arguments: ctx.arguments,
      grant: ctx.grant,
    });
    // executeFetchUrl always throws; satisfy the return type.
    return { output: undefined, truncated: false, redacted: false };
  },
};
