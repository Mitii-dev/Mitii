/**
 * Prefer agent-run selective test evidence over hollow finish-phase verify.
 * Process exitCode is authoritative when present (tool "succeeded" ≠ green).
 */

export type AgentVerifyEvidence = {
  note: string;
  outcome: "passed" | "failed" | "ran_unknown" | "could_not_run";
  command: string;
  exitCode?: number;
  hint?: string;
};

export function summarizeAgentVerifyEvidence(
  journal: readonly {
    toolName?: string;
    toolId?: string;
    status?: string;
    output?: unknown;
    outputPreview?: string;
    summary?: string;
    exitCode?: number;
  }[],
): string | undefined {
  return extractAgentVerifyEvidence(journal)?.note;
}

export function extractAgentVerifyEvidence(
  journal: readonly {
    toolName?: string;
    toolId?: string;
    status?: string;
    output?: unknown;
    outputPreview?: string;
    summary?: string;
    exitCode?: number;
  }[],
): AgentVerifyEvidence | undefined {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index]!;
    const toolName = entry.toolName ?? entry.toolId;
    if (
      toolName !== "run_readonly_command" &&
      toolName !== "run_command"
    ) {
      continue;
    }
    const parsed = parseCommandResult(entry);
    if (!parsed || !looksLikeVerifyCommand(parsed.argv)) continue;
    const shortCmd =
      parsed.command.length > 120
        ? `${parsed.command.slice(0, 117)}...`
        : parsed.command;
    const exitCode =
      typeof entry.exitCode === "number"
        ? entry.exitCode
        : parsed.exitCode;

    if (exitCode === 0) {
      return {
        note: `Passed via \`${shortCmd}\``,
        outcome: "passed",
        command: parsed.command,
        exitCode: 0,
        ...(parsed.hint ? { hint: parsed.hint } : {}),
      };
    }
    if (typeof exitCode === "number") {
      const note = parsed.hint
        ? `Failed via \`${shortCmd}\` (exit ${exitCode}: ${parsed.hint})`
        : `Failed via \`${shortCmd}\` (exit ${exitCode})`;
      return {
        note,
        outcome: "failed",
        command: parsed.command,
        exitCode,
        ...(parsed.hint ? { hint: parsed.hint } : {}),
      };
    }
    if (entry.status === "succeeded") {
      return {
        note: `Ran \`${shortCmd}\` (exit code unknown)`,
        outcome: "ran_unknown",
        command: parsed.command,
        ...(parsed.hint ? { hint: parsed.hint } : {}),
      };
    }
    if (entry.status === "failed") {
      return {
        note: `Could not run \`${shortCmd}\``,
        outcome: "could_not_run",
        command: parsed.command,
        ...(parsed.hint ? { hint: parsed.hint } : {}),
      };
    }
  }
  return undefined;
}

function parseCommandResult(entry: {
  output?: unknown;
  outputPreview?: string;
  summary?: string;
  exitCode?: number;
}):
  | { argv: string[]; command: string; exitCode?: number; hint?: string }
  | undefined {
  const fromOutput = asCommandPayload(entry.output);
  if (fromOutput) return fromOutput;

  if (typeof entry.outputPreview === "string" && entry.outputPreview.trim()) {
    const preview = entry.outputPreview.trim();
    try {
      const parsed = JSON.parse(preview) as unknown;
      const fromPreview = asCommandPayload(parsed);
      if (fromPreview) return fromPreview;
    } catch {
      // Truncated JSON previews are common — recover exitCode/argv/hint.
      const recovered = recoverFromTruncatedPreview(preview);
      if (recovered) return recovered;
    }
  }

  const summary = entry.summary?.trim() ?? "";
  const argvMatch = /argv="([^"]+)"/.exec(summary);
  if (!argvMatch?.[1]) return undefined;
  const argv = argvMatch[1].split(/\s+/).filter(Boolean);
  const exitFromSummary = /exit(?:Code)?[=:\s]+(-?\d+)/i.exec(summary);
  return {
    argv,
    command: argv.join(" "),
    ...(exitFromSummary
      ? { exitCode: Number(exitFromSummary[1]) }
      : typeof entry.exitCode === "number"
        ? { exitCode: entry.exitCode }
        : {}),
  };
}

function asCommandPayload(value: unknown):
  | { argv: string[]; command: string; exitCode?: number; hint?: string }
  | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as {
    argv?: unknown;
    exitCode?: unknown;
    stderr?: unknown;
    stdout?: unknown;
    hint?: unknown;
  };
  const argv = Array.isArray(record.argv)
    ? record.argv.filter((part): part is string => typeof part === "string")
    : [];
  if (argv.length === 0 && typeof record.exitCode !== "number") {
    return undefined;
  }
  const hint =
    (typeof record.hint === "string" && record.hint.trim()
      ? record.hint.trim().slice(0, 80)
      : undefined) ??
    firstNonEmptyLine(
      typeof record.stderr === "string" ? record.stderr : undefined,
      typeof record.stdout === "string" ? record.stdout : undefined,
    );
  return {
    argv,
    command: argv.join(" "),
    ...(typeof record.exitCode === "number"
      ? { exitCode: record.exitCode }
      : {}),
    ...(hint ? { hint } : {}),
  };
}

/** Recover fields when preview JSON was sliced mid-object. */
function recoverFromTruncatedPreview(preview: string):
  | { argv: string[]; command: string; exitCode?: number; hint?: string }
  | undefined {
  const exitMatch = /"exitCode"\s*:\s*(-?\d+)/.exec(preview);
  const exitCode = exitMatch ? Number(exitMatch[1]) : undefined;
  const argv = recoverArgv(preview);
  if (argv.length === 0 && typeof exitCode !== "number") return undefined;
  const hintMatch = /"hint"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(preview);
  const hint = hintMatch?.[1]
    ? hintMatch[1].replace(/\\"/g, '"').replace(/\\n/g, " ").slice(0, 80)
    : undefined;
  return {
    argv,
    command: argv.join(" "),
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    ...(hint ? { hint } : {}),
  };
}

function recoverArgv(preview: string): string[] {
  const arrayMatch = /"argv"\s*:\s*\[([^\]]*)\]/.exec(preview);
  if (!arrayMatch?.[1]) return [];
  const parts: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(arrayMatch[1])) !== null) {
    parts.push(hit[1]!.replace(/\\"/g, '"'));
  }
  return parts;
}

function firstNonEmptyLine(
  ...blobs: Array<string | undefined>
): string | undefined {
  for (const blob of blobs) {
    if (!blob) continue;
    const line = blob
      .split("\n")
      .find((row) => row.trim().length > 0)
      ?.trim()
      .slice(0, 80);
    if (line) return line;
  }
  return undefined;
}

function looksLikeVerifyCommand(argv: readonly string[]): boolean {
  const head = (argv[0] ?? "").toLowerCase();
  const joined = argv.join(" ").toLowerCase();
  if (head === "node" || head === "nodejs") {
    return (
      argv.includes("--test") ||
      joined.includes("vitest") ||
      joined.includes("--check")
    );
  }
  if (
    head === "pnpm" ||
    head === "npm" ||
    head === "yarn" ||
    head === "bun" ||
    head === "npx"
  ) {
    return /\b(test|typecheck|lint|build|vitest|tsc)\b/.test(joined);
  }
  return head === "tsc" || head === "vitest" || head === "pytest";
}
