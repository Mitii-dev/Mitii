import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  convertTimeInputSchema,
  convertTimeOutputSchema,
  defineTool,
  getCurrentTimeInputSchema,
  getCurrentTimeOutputSchema,
} from "../../internal/ToolCatalog";
import {
  executeConvertTime,
  executeGetCurrentTime,
} from "../ExecuteTimeTools";
import { resolveLocalTimezoneId } from "../../internal/TimeTools";

const localTz = resolveLocalTimezoneId();

export const getCurrentTimeTool: RegisteredTool = {
  definition: defineTool({
    name: "get_current_time",
    effects: ["workspace_read"],
    backend: "local",
    status: "available",
    description:
      `Get the current time in an IANA timezone (default: host local ${localTz}). ` +
      "Returns ISO datetime, day of week, and DST flag. Read-only.",
    inputSchema: getCurrentTimeInputSchema,
    outputSchema: getCurrentTimeOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: `IANA timezone (optional; defaults to ${localTz}).`,
        },
      },
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeGetCurrentTime({ arguments: ctx.arguments });
  },
};

export const convertTimeTool: RegisteredTool = {
  definition: defineTool({
    name: "convert_time",
    effects: ["workspace_read"],
    backend: "local",
    status: "available",
    description:
      "Convert an HH:MM (24-hour) wall time from a source IANA timezone to a target timezone for today's date. Returns both snapshots and the offset difference.",
    inputSchema: convertTimeInputSchema,
    outputSchema: convertTimeOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        sourceTimezone: { type: "string" },
        time: {
          type: "string",
          description: "HH:MM in 24-hour format.",
        },
        targetTimezone: { type: "string" },
      },
      required: ["sourceTimezone", "time", "targetTimezone"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeConvertTime({ arguments: ctx.arguments });
  },
};
