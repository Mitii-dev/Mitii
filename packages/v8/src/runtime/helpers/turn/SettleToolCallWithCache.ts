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
  }

  reasonCodes.push(
    ...applyTaskSettleToStore({
      store: input.store,
      args: input.args,
      effect: input.effect,
      status,
    }),
  );

  return { journal, status, reasonCodes, denial };
}
