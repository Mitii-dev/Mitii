import type { TurnLoopSketch } from "../../flow/steps/10-TurnLoop";

export function recordToolSummary(
  rows: NonNullable<TurnLoopSketch["toolSummaries"]>,
  invocationId: string,
  patch: {
    summary?: string;
    reasonCode?: string;
    outputPreview?: string;
    exitCode?: number;
  },
): void {
  const existing = rows.find((row) => row.invocationId === invocationId);
  if (existing) {
    if (patch.summary) existing.summary = patch.summary;
    if (patch.reasonCode) existing.reasonCode = patch.reasonCode;
    if (patch.outputPreview) existing.outputPreview = patch.outputPreview;
    if (typeof patch.exitCode === "number") existing.exitCode = patch.exitCode;
    return;
  }
  rows.push({
    invocationId,
    ...(patch.summary ? { summary: patch.summary } : {}),
    ...(patch.reasonCode ? { reasonCode: patch.reasonCode } : {}),
    ...(patch.outputPreview ? { outputPreview: patch.outputPreview } : {}),
    ...(typeof patch.exitCode === "number" ? { exitCode: patch.exitCode } : {}),
  });
}

/**
 * Compact preview for usage/leftover sketches.
 * Process tools put exitCode/argv first so truncation cannot drop the verdict.
 */
export function previewToolOutput(
  output: unknown,
  reason: string | undefined,
  ok: boolean,
): string | undefined {
  if (!ok && reason?.trim()) {
    return reason.trim().slice(0, 1_000);
  }
  const processPreview = compactProcessOutputPreview(output);
  if (processPreview) return processPreview;
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

/** First-class exitCode for process tool payloads (authoritative). */
export function extractProcessExitCode(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const exitCode = (output as { exitCode?: unknown }).exitCode;
  return typeof exitCode === "number" ? exitCode : undefined;
}

export function compactProcessOutputPreview(
  output: unknown,
): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const record = output as {
    argv?: unknown;
    exitCode?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  const hasExit = typeof record.exitCode === "number";
  const argv = Array.isArray(record.argv)
    ? record.argv.filter((part): part is string => typeof part === "string")
    : [];
  if (!hasExit && argv.length === 0) return undefined;

  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const hintLine =
    [...stderr.split("\n"), ...stdout.split("\n")].find(
      (line) => line.trim().length > 0,
    )?.trim() ?? "";

  // exitCode first — leftover verify must survive a 240-char slice.
  const envelope: Record<string, unknown> = {};
  if (hasExit) envelope.exitCode = record.exitCode;
  if (argv.length > 0) envelope.argv = argv;
  if (hintLine) envelope.hint = hintLine.slice(0, 120);
  try {
    return JSON.stringify(envelope).slice(0, 240);
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
