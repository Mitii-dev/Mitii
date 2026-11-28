import type { ToolInvocationRecord } from "./ToolInvocationRecord";

export function settleToolInvocation(
  journal: ToolInvocationRecord[],
  params: {
    invocationId: string;
    status: Extract<
      ToolInvocationRecord["status"],
      "succeeded" | "failed" | "cancelled" | "uncertain"
    >;
    finishedAt: string;
  },
): ToolInvocationRecord[] {
  return journal.map((r) =>
    r.invocationId === params.invocationId
      ? {
          ...r,
          status: params.status,
          finishedAt: params.finishedAt,
        }
      : r,
  );
}
