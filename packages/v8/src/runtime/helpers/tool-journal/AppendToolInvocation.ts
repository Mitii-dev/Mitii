import {
  toolInvocationRecordSchema,
  type ToolInvocationRecord,
} from "./ToolInvocationRecord";

export function appendToolInvocation(
  journal: ToolInvocationRecord[],
  record: ToolInvocationRecord,
): ToolInvocationRecord[] {
  const parsed = toolInvocationRecordSchema.parse(record);
  return [...journal, parsed];
}

export function findByIdempotencyKey(
  journal: ToolInvocationRecord[],
  key: string,
): ToolInvocationRecord | undefined {
  return journal.find((r) => r.idempotencyKey === key);
}
