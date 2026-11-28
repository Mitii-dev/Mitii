import type {
  RuntimeModelPort,
  RuntimeModelResponse,
} from "../../ports/RuntimeModelPort";

/** Deterministic model for turn-loop tests. */
export function scriptedModelPort(
  responses: RuntimeModelResponse[],
): RuntimeModelPort {
  let i = 0;
  return {
    async complete() {
      const next = responses[Math.min(i, responses.length - 1)] ?? {
        text: "",
        toolCalls: [],
        reasonCodes: ["scripted_empty"],
      };
      i += 1;
      return next;
    },
  };
}
