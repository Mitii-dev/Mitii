import {
  ToolRuntimeError,
  toolInvocationInputSchema,
} from "../../contracts";
import type { ToolInvocationInput } from "../../contracts";

export function parseInvocation(input: unknown): ToolInvocationInput {
  try {
    return toolInvocationInputSchema.parse(input);
  } catch (error) {
    throw new ToolRuntimeError(
      "invalid_input",
      "Tool Runtime input failed schema validation.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
