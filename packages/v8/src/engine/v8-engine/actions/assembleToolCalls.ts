import type { ModelToolCall, ModelToolCallDelta } from "../../../modules/model-gateway";

/**
 * Assemble streamed tool_call_delta fragments into complete tool calls.
 */
export function assembleToolCalls(
  deltas: readonly ModelToolCallDelta[],
): ModelToolCall[] {
  const byIndex = new Map<
    number,
    {
      id?: string;
      name?: string;
      arguments: string;
      thoughtSignature?: string;
    }
  >();

  for (const delta of deltas) {
    const current = byIndex.get(delta.index) ?? { arguments: "" };
    if (delta.id !== undefined && delta.id.length > 0) {
      current.id = delta.id;
    }
    if (delta.name !== undefined && delta.name.length > 0) {
      current.name = delta.name;
    }
    if (delta.arguments !== undefined) {
      current.arguments += delta.arguments;
    }
    if (
      delta.thoughtSignature !== undefined &&
      delta.thoughtSignature.length > 0
    ) {
      current.thoughtSignature = delta.thoughtSignature;
    }
    byIndex.set(delta.index, current);
  }

  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, value], index) => ({
      id: value.id && value.id.length > 0 ? value.id : `tool_call_${index}`,
      name: value.name ?? "",
      arguments: value.arguments,
      ...(value.thoughtSignature
        ? { thoughtSignature: value.thoughtSignature }
        : {}),
    }))
    .filter((call) => call.name.length > 0);
}
