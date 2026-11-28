import { packTurn } from "../../helpers/store/PackTurn";
import {
  getOrCreateToolCallCache,
} from "../../helpers/store/ToolCallCache";
import { evaluateSoftRails } from "../../helpers/rails";
import { countTurnHeartbeats } from "../../helpers/heartbeat/CountTurnHeartbeats";
import {
  appendToolInvocation,
  findByIdempotencyKey,
} from "../../helpers/tool-journal/AppendToolInvocation";
import { buildIdempotencyKey } from "../../helpers/tool-journal/BuildIdempotencyKey";
import { settleToolInvocation } from "../../helpers/tool-journal/SettleToolInvocation";
import type { ToolInvocationRecord } from "../../helpers/tool-journal";
import { applyTaskSettleToStore } from "../../helpers/task";
import { extractChangedPathsFromToolArgs } from "../../helpers/task/ExtractChangedPathsFromToolArgs";
import {
  evaluateAfterToolGate,
  evaluateOnBudgetGate,
  mapGateVerdictToTurnGate,
  resolveBudgetHardWall,
  type TurnLoopHubGate,
} from "../../helpers/turn";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { classifyToolEffect } from "../../tools/ClassifyToolEffect";
import { isGrantDenyReason } from "../../tools/GrantDenyReasons";
import type { TaskList } from "../../../modules/task-list";
import type { ContextBundleSketch } from "./9-EnrichContext";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

export type TurnLoopGateSketch = TurnLoopHubGate;

export interface TurnLoopSketch {
  cancelled: boolean;
  packedTools: string[];
  softRails: ReturnType<typeof evaluateSoftRails>;
  journal: ToolInvocationRecord[];
  denials: string[];
  reasonCodes: string[];
  /** Heartbeats emitted over the turn-loop wall span. */
  heartbeats?: number;
  /** Mid-turn hard gate — hub evaluateGates only (never a soft rail). */
  gate?: TurnLoopGateSketch;
  /** Actual model.complete calls this loop (not stubbed to 0/1). */
  modelCallCount?: number;
  /** Outer turn-loop iterations that ran a model call. */
  loopIterations?: number;
  /** Aggregated provider token usage across model calls. */
  usageTotals?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
  };
  /** True when model_turn was pushed live to the event sink. */
  liveModelEvents?: boolean;
  /** True when content/reasoning model_delta chunks were pushed live. */
  liveContentDeltas?: boolean;
  /** True when tool_started / tool_completed were pushed live. */
  liveToolEvents?: boolean;
  /** Path/argv summaries keyed by invocation for usage/bridge sketches. */
  toolSummaries?: Array<{
    invocationId: string;
    summary?: string;
    reasonCode?: string;
    outputPreview?: string;
    /** Process tool exitCode — authoritative for verify evidence. */
    exitCode?: number;
  }>;
}

/**
 * Step 10 — turn loop shell: cancel → packTurn ⊆ grant → soft rails → journal.
 * after_tool / on_budget consult the gates hub (S11-LOOP).
 */
export function turnLoopShell(
  ctx: StepContext,
  opts?: {
    grant?: GrantSurface;
    simulatedToolCalls?: Array<{
      toolId: string;
      args?: unknown;
      effect?: "none" | "read" | "mutate" | "external";
    }>;
  },
): TurnLoopSketch {
  if (ctx.store.isCancelling()) {
    const sketch: TurnLoopSketch = {
      cancelled: true,
      packedTools: [],
      softRails: [],
      journal: [],
      denials: [],
      reasonCodes: ["turn_loop_cancelled"],
    };
    ctx.store.setSlice("turnLoop", sketch);
    return sketch;
  }

  const loopStartedAtMs = Date.now();
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const bundle = ctx.store.getSlice<ContextBundleSketch>("contextBundle");
  const taskList = ctx.store.getSlice<TaskList>("taskList");
  const grant: GrantSurface = opts?.grant ?? defaultGrantFromDecision(decision);
  const runId = ctx.store.getStore().runId;
  const toolCache = getOrCreateToolCallCache(ctx.store);

  const packed = packTurn({
    messages: [{ role: "user", content: ctx.input.message }],
    grant,
    contextBundleSummary: bundle?.summary,
    ...(bundle ? { contextBundle: bundle } : {}),
    ...(taskList ? { taskList } : {}),
  });

  let journal =
    ctx.store.getSlice<ToolInvocationRecord[]>("toolJournal") ?? [];
  const denials: string[] = [];
  const reasonCodes = ["turn_loop_shell", ...packed.reasonCodes];
  const now = new Date().toISOString();
  let gate: TurnLoopGateSketch | undefined;
  let toolCallCount = 0;

  for (const call of opts?.simulatedToolCalls ?? []) {
    if (gate) break;
    toolCallCount += 1;
    const effect = call.effect ?? classifyToolEffect(call.toolId);
    const check = checkToolAgainstGrant({
      toolId: call.toolId,
      effect,
      grant,
    });
    if (!check.ok) {
      denials.push(check.reason ?? "tool_not_allowed");
      const denyReason =
        check.reason && isGrantDenyReason(check.reason)
          ? check.reason
          : undefined;
      const afterTool = evaluateAfterToolGate({
        runId,
        mode: ctx.mode,
        route: decision?.route,
        effect,
        grant,
        denyReason,
        enableExtendedGates: ctx.deps?.enableExtendedGates === true,
      });
      gate = mapGateVerdictToTurnGate(afterTool, {
        toolId: call.toolId,
        invocationId: `inv_${journal.length + 1}`,
      });
      if (gate) reasonCodes.push(...gate.reasonCodes);
      continue;
    }

    const afterTool = evaluateAfterToolGate({
      runId,
      mode: ctx.mode,
      route: decision?.route,
      effect,
      grant,
      needsExternalSideEffectApproval: effect === "external",
      enableExtendedGates: ctx.deps?.enableExtendedGates === true,
    });
    const hubGate = mapGateVerdictToTurnGate(afterTool, {
      toolId: call.toolId,
      invocationId: `inv_${journal.length + 1}`,
    });
    if (hubGate) {
      gate = hubGate;
      reasonCodes.push(...hubGate.reasonCodes);
      break;
    }

    const idempotencyKey = buildIdempotencyKey({
      toolId: call.toolId,
      args: call.args ?? {},
    });
    const cached = toolCache.getByContent(call.toolId, call.args ?? {});
    if (cached?.ok && effect === "read") {
      reasonCodes.push("tool_call_cache_hit");
      continue;
    }
    const existing = findByIdempotencyKey(journal, idempotencyKey);
    if (existing?.status === "succeeded") {
      continue;
    }
    const invocationId = `inv_${journal.length + 1}`;
    journal = appendToolInvocation(journal, {
      invocationId,
      toolId: call.toolId,
      idempotencyKey,
      status: "pending",
      inputHash: idempotencyKey,
      effectClass: effect === "mutate" ? "mutate" : "read",
      startedAt: now,
    });
    journal = settleToolInvocation(journal, {
      invocationId,
      status: "succeeded",
      finishedAt: now,
    });
    const paths = extractChangedPathsFromToolArgs(call.args);
    toolCache.set(invocationId, {
      toolId: call.toolId,
      ok: true,
      paths,
    });
    if (effect === "read") {
      toolCache.setContent(call.toolId, call.args ?? {}, {
        toolId: call.toolId,
        ok: true,
        paths,
      });
    } else if (effect === "mutate") {
      const wiped = toolCache.invalidateContent(paths);
      reasonCodes.push(
        wiped > 0
          ? `tool_call_cache_invalidated_${wiped}`
          : "tool_call_cache_invalidate_empty",
      );
    }
    reasonCodes.push(
      ...applyTaskSettleToStore({
        store: ctx.store,
        args: call.args,
        effect,
        status: "succeeded",
      }),
    );
  }

  ctx.store.setSlice("toolJournal", journal);

  const softRails = evaluateSoftRails({
    repeatedToolCalls: opts?.simulatedToolCalls?.length ?? 0,
    budgetUsedRatio: denials.length > 0 ? 0.5 : 0.1,
  });

  if (!gate) {
    const hard = resolveBudgetHardWall({
      toolCallCount,
      maxToolCalls: decision?.toolGrant?.limits?.maxToolCalls,
      elapsedMs: Date.now() - loopStartedAtMs,
      wallTimeSoftMs: ctx.deps?.wallTimeSoftMs,
    });
    gate = mapGateVerdictToTurnGate(
      evaluateOnBudgetGate({
        runId,
        mode: ctx.mode,
        route: decision?.route,
        budgetHardWall: hard,
        softRails,
      }),
    );
    if (gate) reasonCodes.push(...gate.reasonCodes);
  }

  const heartbeats = countTurnHeartbeats({
    startedAtMs: loopStartedAtMs,
    nowMs: Date.now(),
    intervalMs: ctx.deps?.heartbeatIntervalMs,
  });

  const sketch: TurnLoopSketch = {
    cancelled: false,
    packedTools: packed.tools,
    softRails,
    journal,
    denials,
    heartbeats,
    reasonCodes: [
      ...reasonCodes,
      ...denials.map((d) => `deny_${d}`),
      "turn_loop_hub_gates",
    ],
    gate,
  };
  ctx.store.setSlice("turnLoop", sketch);
  return sketch;
}

/**
 * Prefer the plate-compiled toolGrant from Decide (full discovery surface).
 * Fallback stubs are only for tests / missing decide sketches.
 */
export function defaultGrantFromDecision(
  decision: RuntimeDecisionSketch | undefined,
): GrantSurface {
  const compiled = decision?.toolGrant;
  if (compiled && compiled.allowedTools.length > 0) {
    return {
      allowedTools: [...compiled.allowedTools],
      maximumWorkspaceEffect: compiled.maximumWorkspaceEffect,
      allowedEffects: [...compiled.allowedEffects],
      approvalMode: compiled.approvalMode,
      pathScopes: [...(compiled.pathScopes ?? [])],
      ...(compiled.commandRules?.length
        ? {
            commandRules: compiled.commandRules.map((rule) => ({
              prefixes: [...rule.prefixes],
              allowShellMetacharacters: rule.allowShellMetacharacters === true,
              ...(typeof rule.maxOutputBytes === "number"
                ? { maxOutputBytes: rule.maxOutputBytes }
                : {}),
            })),
          }
        : {}),
      ...(compiled.scopes?.readPaths
        ? { readPaths: [...compiled.scopes.readPaths] }
        : {}),
      ...(compiled.scopes?.writePaths
        ? { writePaths: [...compiled.scopes.writePaths] }
        : {}),
    };
  }

  if (decision?.grantProfile === "agent_execute") {
    return {
      allowedTools: [
        "read_file",
        "read_many_files",
        "search_files",
        "glob_files",
        "list_directory",
        "directory_tree",
        "apply_patch",
        "run_readonly_command",
        "run_command",
      ],
      maximumWorkspaceEffect: "write",
      allowedEffects: [
        "workspace_write",
        "workspace_read",
        "process_execute",
      ],
      approvalMode: "when_required",
    };
  }
  if (
    decision?.grantProfile === "research" ||
    decision?.grantProfile === "readonly"
  ) {
    return {
      allowedTools: [
        "read_file",
        "read_many_files",
        "search_files",
        "glob_files",
        "list_directory",
        "directory_tree",
        "run_readonly_command",
      ],
      maximumWorkspaceEffect: "read",
      allowedEffects: ["workspace_read", "process_execute"],
      approvalMode: "never",
    };
  }
  return {
    allowedTools: [],
    maximumWorkspaceEffect: "none",
    allowedEffects: [],
    approvalMode: "never",
  };
}
