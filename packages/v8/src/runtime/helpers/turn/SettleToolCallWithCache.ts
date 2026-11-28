/**
 * Journal settle + TaskList advance + ToolCallCache update (S11-LOOP / CACHE-TOOL).
 */

import type { ToolInvocationRecord } from "../tool-journal";
import {
  appendToolInvocation,
  findByIdempotencyKey,
} from "../tool-journal/AppendToolInvocation";
import { buildIdempotencyKey } from "../tool-journal/BuildIdempotencyKey";
import { settleToolInvocation } from "../tool-journal/SettleToolInvocation";
import { applyTaskSettleToStore } from "../task";
import { extractChangedPathsFromToolArgs } from "../task/ExtractChangedPathsFromToolArgs";
import type { ToolCallCache } from "../store/ToolCallCache";
import type { ToolEffectClass } from "../../tools/ClassifyToolEffect";

function extractChangedPathsFromToolOutput(output: unknown): string[] {
  if (!output || typeof output !== "object") return [];
  const record = output as Record<string, unknown>;
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) out.push(value.trim());
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) out.push(item.trim());
        else if (item && typeof item === "object" && "path" in item) {
          const path = (item as { path?: unknown }).path;
          if (typeof path === "string" && path.trim()) out.push(path.trim());
        }
      }
    }
  };
  push(record.changedFiles);
  push(record.paths);
  push(record.files);
  if (Array.isArray(record.applied)) {
    for (const item of record.applied) {
      if (item && typeof item === "object" && "path" in item) {
        push((item as { path?: unknown }).path);
      }
    }
  }
  return [...new Set(out)].slice(0, 64);
}

/** Prefer output paths when args omit them (common for patch tools). */
function mergeArgsWithOutputPaths(args: unknown, output: unknown): unknown {
  const fromOutput = extractChangedPathsFromToolOutput(output);
  if (fromOutput.length === 0) return args;
  const base =
    args && typeof args === "object" && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : {};
  const existing = extractChangedPathsFromToolArgs(base);
  return {
    ...base,
    changedPaths: [...new Set([...existing, ...fromOutput])],
  };
}

export async function settleToolCallWithCache(input: {
  journal: ToolInvocationRecord[];
  toolCache: ToolCallCache;
  store: {
    getSlice: <T>(key: string) => T | undefined;
    setSlice: (key: string, value: unknown) => void;
  };
  toolId: string;
  args: unknown;
  effect: ToolEffectClass;
  invocationId: string;
  execute?: () => Promise<{
    ok: boolean;
    output?: unknown;
    reasonCode?: string;
  }>;
}): Promise<{
  journal: ToolInvocationRecord[];
  status: "succeeded" | "failed" | "skipped_cache" | "skipped_idempotent";
  reasonCodes: string[];
  denial?: string;
}> {
  const reasonCodes: string[] = [];
  if (input.effect === "read") {
    const cached = input.toolCache.getByContent(input.toolId, input.args);
    if (cached?.ok) {
      return {
        journal: input.journal,
        status: "skipped_cache",
        reasonCodes: ["tool_call_cache_hit"],
      };
    }
  }

  const idempotencyKey = buildIdempotencyKey({
    toolId: input.toolId,
    args: input.args,
  });
  const existing = findByIdempotencyKey(input.journal, idempotencyKey);
  if (existing?.status === "succeeded") {
    return {
      journal: input.journal,
      status: "skipped_idempotent",
      reasonCodes: ["tool_call_idempotent_replay"],
    };
  }

  const now = new Date().toISOString();
  let journal = appendToolInvocation(input.journal, {
    invocationId: input.invocationId,
    toolId: input.toolId,
    idempotencyKey,
    status: "pending",
    inputHash: idempotencyKey,
    effectClass: input.effect === "mutate" ? "mutate" : "read",
    startedAt: now,
  });

  let status: "succeeded" | "failed" = "succeeded";
  let output: unknown;
  let denial: string | undefined;
  if (input.execute) {
    const result = await input.execute();
    if (!result.ok) {
      status = "failed";
      denial = result.reasonCode;
    } else {
      output = result.output;
    }
  }

  journal = settleToolInvocation(journal, {
    invocationId: input.invocationId,
    status,
    finishedAt: new Date().toISOString(),
  });

  const paths = extractChangedPathsFromToolArgs(input.args);
  input.toolCache.set(input.invocationId, {
    toolId: input.toolId,
    ok: status === "succeeded",
    output,
    reasonCode: denial,
    paths,
  });

  if (status === "succeeded" && input.effect === "read") {
    input.toolCache.setContent(input.toolId, input.args, {
      toolId: input.toolId,
      ok: true,
      output,
      paths,
    });
  } else if (status === "succeeded" && input.effect === "mutate") {
    const wiped = input.toolCache.invalidateContent(paths);
    reasonCodes.push(
      wiped > 0
        ? `tool_call_cache_invalidated_${wiped}`
        : "tool_call_cache_invalidate_empty",
    );
    const fromOutput = extractChangedPathsFromToolOutput(output);
    const allPaths = [...new Set([...paths, ...fromOutput])].slice(0, 64);
    if (allPaths.length > 0) {
      const prior =
        input.store.getSlice<string[]>("changedFiles") ??
        input.store.getSlice<string[]>("mutatedPaths") ??
        [];
      input.store.setSlice("changedFiles", [
        ...new Set([...prior, ...allPaths]),
      ]);
    }
  }

  reasonCodes.push(
    ...applyTaskSettleToStore({
      store: input.store,
      args: mergeArgsWithOutputPaths(input.args, output),
      effect: input.effect,
      status,
    }),
  );

  return { journal, status, reasonCodes, denial };
}
