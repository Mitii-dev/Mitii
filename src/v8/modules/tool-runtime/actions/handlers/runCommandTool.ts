import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  runCommandInputSchema,
  runCommandOutputSchema,
} from "../../internal/ToolCatalog";
import { GrantValidationError } from "../ValidateGrant";

/**
 * Catalogued for Decision Policy execute grants. Writing shell commands remain
 * opt-in and separately designed; Phase 8 ships apply_patch first.
 */
export const runCommandTool: RegisteredTool = {
  definition: defineTool({
    name: "run_command",
    effects: ["process_execute", "workspace_write"],
    backend: "local",
    status: "unavailable",
    description:
      "Run an authorized mutating command (catalogued; not executable in Phase 8 vertical slice).",
    inputSchema: runCommandInputSchema,
    outputSchema: runCommandOutputSchema,
    executeSupported: false,
  }),
  async execute(ctx) {
    // Still enforce grant so unauthorized attempts fail closed with effect codes.
    if (!ctx.grant.allowedTools.includes("run_command")) {
      throw new GrantValidationError(
        "tool_not_allowed",
        'Tool "run_command" is not in grant.allowedTools.',
      );
    }
    throw new GrantValidationError(
      "tool_unavailable",
      'Tool "run_command" is catalogued but not executable yet.',
    );
  },
};
