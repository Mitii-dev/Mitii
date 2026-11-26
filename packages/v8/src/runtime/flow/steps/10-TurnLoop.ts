import { packTurn } from "../../helpers/store/PackTurn";
import { evaluateSoftRails } from "../../helpers/rails";
import { countTurnHeartbeats } from "../../helpers/heartbeat/CountTurnHeartbeats";
import {
  appendToolInvocation,
  findByIdempotencyKey,
} from "../../helpers/tool-journal/AppendToolInvocation";
import { buildIdempotencyKey } from "../../helpers/tool-journal/BuildIdempotencyKey";
import { settleToolInvocation } from "../../helpers/tool-journal/SettleToolInvocation";
import type { ToolInvocationRecord } from "../../helpers/tool-journal";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { classifyToolEffect } from "../../tools/ClassifyToolEffect";
import { needsMutationApproval } from "../../tools/NeedsMutationApproval";
import type { ContextBundleSketch } from "./9-EnrichContext";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

export interface TurnLoopGateSketch {
  status: "suspended";
  kind: "mutation_approval_required";
  toolId?: string;
  invocationId?: string;
  reasonCodes: string[];
}

export interface TurnLoopSketch {
  cancelled: boolean;
  packedTools: string[];
  softRails: ReturnType<typeof evaluateSoftRails>;
  journal: ToolInvocationRecord[];
  denials: string[];
  reasonCodes: string[];
  /** Heartbeats emitted over the turn-loop wall span. */
  heartbeats?: number;
  /** Mid-turn hard gate (e.g. mutation approval) — never a soft rail. */
  gate?: TurnLoopGateSketch;
}

/**
 * Step 10 — turn loop shell: cancel → packTurn ⊆ grant → soft rails → journal.
 * Model/tool adapters still engine-owned until evacuate.
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
  const grant: GrantSurface = opts?.grant ?? defaultGrantFromDecision(decision);

  const packed = packTurn({
    messages: [{ role: "user", content: ctx.input.message }],
    grant,
    contextBundleSummary: bundle?.summary,
  });

  let journal =
    ctx.store.getSlice<ToolInvocationRecord[]>("toolJournal") ?? [];
  const denials: string[] = [];
  const reasonCodes = ["turn_loop_shell", ...packed.reasonCodes];
  const now = new Date().toISOString();
  let gate: TurnLoopGateSketch | undefined;

  for (const call of opts?.simulatedToolCalls ?? []) {
    const effect = call.effect ?? classifyToolEffect(call.toolId);
    const check = checkToolAgainstGrant({
      toolId: call.toolId,
      effect,
      grant,
    });
    if (!check.ok) {
      denials.push(check.reason ?? "tool_not_allowed");
      continue;
    }
    if (needsMutationApproval({ effect, grant })) {
      const invocationId = `inv_${journal.length + 1}`;
      gate = {
        status: "suspended",
        kind: "mutation_approval_required",
        toolId: call.toolId,
        invocationId,
        reasonCodes: ["gate_mutation_approval_required", "approval_required"],
      };
      reasonCodes.push(...gate.reasonCodes);
      break;
    }
    const idempotencyKey = buildIdempotencyKey({
      toolId: call.toolId,
      args: call.args ?? {},
    });
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
  }

  ctx.store.setSlice("toolJournal", journal);

  const softRails = evaluateSoftRails({
    repeatedToolCalls: opts?.simulatedToolCalls?.length ?? 0,
    budgetUsedRatio: denials.length > 0 ? 0.5 : 0.1,
  });

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
    reasonCodes: [...reasonCodes, ...denials.map((d) => `deny_${d}`)],
    gate,
  };
  ctx.store.setSlice("turnLoop", sketch);
  return sketch;
}

export function defaultGrantFromDecision(
  decision: RuntimeDecisionSketch | undefined,
): GrantSurface {
  if (decision?.grantProfile === "agent_execute") {
    return {
      allowedTools: ["read_file", "apply_patch", "run_readonly_command"],
      maximumWorkspaceEffect: "write",
      allowedEffects: ["workspace_write", "workspace_read"],
      approvalMode: "every_mutation",
    };
  }
  if (
    decision?.grantProfile === "research" ||
    decision?.grantProfile === "readonly"
  ) {
    return {
      allowedTools: ["read_file", "search_code", "run_readonly_command"],
      maximumWorkspaceEffect: "read",
      allowedEffects: ["workspace_read"],
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
