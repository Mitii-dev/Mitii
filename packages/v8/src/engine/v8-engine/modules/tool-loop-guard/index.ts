/**
 * Guard against identical tool-batch thrash: soft nudge → force final → reject.
 * Signatures cover tool name + stable arguments (and optional result payloads).
 *
 * For read_file, startLine/endLine stay in the signature so progressive windows
 * of a large file are distinct. Other discovery tools still strip volatile
 * pagination keys so path/query thrash is detected.
 */

export type ToolLoopCall = {
  name: string;
  /** Raw JSON args string or already-parsed object. */
  arguments?: unknown;
};

export type ToolLoopResult = {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
};

export type ToolLoopCallDecision =
  | { type: "allow"; signature: string; repeatCount: number }
  | { type: "soft"; signature: string; repeatCount: number }
  | { type: "force_final"; signature: string; repeatCount: number }
  | {
      type: "reject";
      signature: string;
      violationCount: number;
      exhausted: boolean;
    };

export type ToolLoopResultDecision = {
  signature: string;
  repeatCount: number;
  forcedFinalResponse: boolean;
};

export type ToolLoopGuardOptions = {
  softIdenticalLimit?: number;
  hardIdenticalLimit?: number;
  identicalCallAndResultLimit?: number;
  forcedRejectLimit?: number;
};

/** Volatile window / pagination keys that should not defeat path thrash detection. */
const VOLATILE_ARG_KEYS = new Set([
  "startLine",
  "endLine",
  "maxLines",
  "head",
  "tail",
  "maxMatches",
  "maxResults",
  "maxCount",
  "maxBytes",
  "maxBytesPerFile",
  "maxLinesPerFile",
  "offset",
  "limit",
  "caseSensitive",
]);

export function buildToolLoopCallSignature(calls: readonly ToolLoopCall[]): string {
  return calls
    .map((call) => {
      const args =
        call.arguments === undefined
          ? ""
          : stableSerialize(
              canonicalizeArgumentsForLoop(call.name, call.arguments),
            );
      return `${call.name}:${args}`;
    })
    .sort()
    .join("|");
}

export function buildToolLoopResultSignature(
  results: readonly ToolLoopResult[],
): string {
  return results
    .map((result) => {
      const payload = result.success
        ? (result.output ?? "")
        : (result.error ?? result.output ?? "");
      return `${result.name}:${result.success ? "ok" : "err"}:${normalizeText(payload)}`;
    })
    .sort()
    .join("|");
}

export class ToolLoopGuard {
  private readonly softIdenticalLimit: number;
  private readonly hardIdenticalLimit: number;
  private readonly identicalCallAndResultLimit: number;
  private readonly forcedRejectLimit: number;
  private lastCallSignature = "";
  private identicalCallCount = 0;
  private lastResultSignature = "";
  private identicalResultCount = 0;
  private forceFinal = false;
  private forcedRejectCount = 0;

  constructor(options: ToolLoopGuardOptions = {}) {
    this.softIdenticalLimit = options.softIdenticalLimit ?? 3;
    this.hardIdenticalLimit = options.hardIdenticalLimit ?? 6;
    this.identicalCallAndResultLimit =
      options.identicalCallAndResultLimit ?? 3;
    this.forcedRejectLimit = options.forcedRejectLimit ?? 2;
  }

  isForcingFinalResponse(): boolean {
    return this.forceFinal;
  }

  observeCalls(calls: readonly ToolLoopCall[]): ToolLoopCallDecision {
    const signature = buildToolLoopCallSignature(calls);
    if (signature === this.lastCallSignature) {
      this.identicalCallCount += 1;
    } else {
      this.lastCallSignature = signature;
      this.identicalCallCount = 1;
      this.lastResultSignature = "";
      this.identicalResultCount = 0;
      this.forcedRejectCount = 0;
    }

    if (this.forceFinal) {
      this.forcedRejectCount += 1;
      return {
        type: "reject",
        signature,
        violationCount: this.forcedRejectCount,
        exhausted: this.forcedRejectCount >= this.forcedRejectLimit,
      };
    }

    if (this.identicalCallCount >= this.hardIdenticalLimit) {
      this.forceFinal = true;
      return {
        type: "force_final",
        signature,
        repeatCount: this.identicalCallCount,
      };
    }

    if (this.identicalCallCount >= this.softIdenticalLimit) {
      return {
        type: "soft",
        signature,
        repeatCount: this.identicalCallCount,
      };
    }

    return {
      type: "allow",
      signature,
      repeatCount: this.identicalCallCount,
    };
  }

  observeResults(results: readonly ToolLoopResult[]): ToolLoopResultDecision {
    const signature = buildToolLoopResultSignature(results);
    if (signature === this.lastResultSignature) {
      this.identicalResultCount += 1;
    } else {
      this.lastResultSignature = signature;
      this.identicalResultCount = 1;
    }

    const forcedFinalResponse =
      this.identicalCallCount >= this.identicalCallAndResultLimit &&
      this.identicalResultCount >= this.identicalCallAndResultLimit;
    if (forcedFinalResponse) {
      this.forceFinal = true;
    }

    return {
      signature,
      repeatCount: this.identicalResultCount,
      forcedFinalResponse,
    };
  }
}

export function softToolLoopNudgeMessage(repeatCount: number): string {
  return [
    `Potential tool loop: the same tool batch repeated ${repeatCount} times.`,
    "Change approach — different path, args, or tool — or call apply_patch / give a final answer.",
    "Do not repeat the identical tool call.",
  ].join("\n");
}

export function forceFinalToolLoopMessage(repeatCount: number): string {
  return [
    `Tool loop detected after ${repeatCount} identical batches.`,
    "Do not call tools. Give a short final answer or stop with a Blocker.",
  ].join("\n");
}

/** Kept on read_file so progressive windows do not soft-nudge as identical. */
const READ_FILE_WINDOW_KEYS = new Set(["startLine", "endLine"]);

/**
 * Drop volatile pagination keys for discovery thrash detection.
 * read_file keeps startLine/endLine so large-file paging is not identical.
 */
export function canonicalizeArgumentsForLoop(
  toolName: string,
  value: unknown,
): unknown {
  const parsed = normalizeArguments(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const record = { ...(parsed as Record<string, unknown>) };

  if (toolName === "read_file") {
    for (const key of VOLATILE_ARG_KEYS) {
      if (READ_FILE_WINDOW_KEYS.has(key)) continue;
      delete record[key];
    }
  } else if (
    toolName === "read_many_files" ||
    toolName === "search_files" ||
    toolName === "glob_files" ||
    toolName === "list_directory" ||
    toolName === "read_git_show" ||
    toolName === "read_git_log"
  ) {
    for (const key of VOLATILE_ARG_KEYS) {
      delete record[key];
    }
  }

  if (toolName === "apply_patch" && Array.isArray(record.patches)) {
    // Signature on target paths + rejection-prone shape, not full hunk bodies
    // (bodies vary while the model retries the same file wipe).
    record.patches = (record.patches as unknown[]).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
      }
      const patch = entry as Record<string, unknown>;
      return {
        path: patch.path,
        emptyOldText: patch.oldText === "",
        replaceAll: patch.replaceAll === true,
      };
    });
  }

  return record;
}

function normalizeArguments(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return normalizeArguments(JSON.parse(value) as unknown);
    } catch {
      return value;
    }
  }
  return value;
}

function stableSerialize(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      const record = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        out[key] = normalize(record[key]);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}
