import type { TurnLoopSketch } from "../../flow/steps/10-TurnLoop";

export function recordToolSummary(
  rows: NonNullable<TurnLoopSketch["toolSummaries"]>,
  invocationId: string,
  patch: {
    summary?: string;
    reasonCode?: string;
    outputPreview?: string;
  },
): void {
  const existing = rows.find((row) => row.invocationId === invocationId);
  if (existing) {
    if (patch.summary) existing.summary = patch.summary;
    if (patch.reasonCode) existing.reasonCode = patch.reasonCode;
    if (patch.outputPreview) existing.outputPreview = patch.outputPreview;
    return;
  }
  rows.push({
    invocationId,
    ...(patch.summary ? { summary: patch.summary } : {}),
    ...(patch.reasonCode ? { reasonCode: patch.reasonCode } : {}),
    ...(patch.outputPreview ? { outputPreview: patch.outputPreview } : {}),
  });
}

export function previewToolOutput(
  output: unknown,
  reason: string | undefined,
  ok: boolean,
): string | undefined {
  if (!ok && reason?.trim()) {
    return reason.trim().slice(0, 1_000);
  }
  if (typeof output === "string" && output.trim()) {
    return output.trim().slice(0, 240);
  }
  if (output == null) return undefined;
  try {
    return JSON.stringify(output).slice(0, 240);
  } catch {
    return undefined;
  }
}

export function formatToolMessageContent(
  output: unknown,
  meta: { ok: boolean; reason?: string; status: string },
): string {
  if (typeof output === "string" && output.trim().length > 0) {
    return output.slice(0, 8_000);
  }
  try {
    return JSON.stringify({
      ok: meta.ok,
      status: meta.status,
      ...(meta.reason ? { reason: meta.reason } : {}),
      ...(output !== undefined ? { output } : {}),
    }).slice(0, 8_000);
  } catch {
    return JSON.stringify({
      ok: meta.ok,
      status: meta.status,
      reason: meta.reason ?? "unserializable_output",
    });
  }
}

export function parseRecoveredArgs(raw: string): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}
