import { MODEL_GATEWAY_LIMITS } from "../../constants";

/** Port method: `LlmPort.countTokens` (echo approximate). */
export async function echoCountTokens(text: string): Promise<number> {
  return Math.max(
    1,
    Math.ceil(text.length / MODEL_GATEWAY_LIMITS.APPROXIMATE_CHARS_PER_TOKEN),
  );
}
