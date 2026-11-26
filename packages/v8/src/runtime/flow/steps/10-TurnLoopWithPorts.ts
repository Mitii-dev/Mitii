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
import { applyTaskSettleToStore } from "../../helpers/task";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";
import { classifyToolEffect } from "../../tools/ClassifyToolEffect";
import { needsMutationApproval } from "../../tools/NeedsMutationApproval";
import type { TaskList } from "../../../modules/task-list";
import type { ContextBundleSketch } from "./9-EnrichContext";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";
import {
  defaultGrantFromDecision,
  type TurnLoopGateSketch,
  type TurnLoopSketch,
} from "./10-TurnLoop";

const MAX_PORT_TURNS = 4;

/**
 * Step 10 with injected model/tool ports — packTurn → model → grant → journal settle.
 * Mutate tools under every_mutation / when_required suspend mid-turn.
 */
export async function turnLoopWithPorts(
  ctx: StepContext,
  deps: RuntimeDependencies,
  opts?: { grant?: GrantSurface },
): Promise<TurnLoopSketch> {
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
  const reasonCodes = ["turn_loop_with_ports", ...packed.reasonCodes];
  let assistantText = "";
  let toolCallCount = 0;
  let gate: TurnLoopGateSketch | undefined;

  if (deps.model) {
    for (let turn = 0; turn < MAX_PORT_TURNS; turn++) {
      if (ctx.store.isCancelling() || gate) break;
      if (ctx.abortSignal?.aborted || ctx.store.isCancelling()) {
        break;
      }
      const response = await deps.model.complete(
        {
          messages: [
            ...(packed.systemPrefix
              ? [{ role: "system" as const, content: packed.systemPrefix }]
              : []),
            ...packed.messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system" | "tool",
              content: m.content,
            })),
          ],
          tools: packed.tools,
          systemPrefix: packed.systemPrefix,
        },
        { abortSignal: ctx.abortSignal },
      );
      reasonCodes.push(...response.reasonCodes);
      assistantText = response.text;
      if (response.toolCalls.length === 0) break;

      for (const call of response.toolCalls) {
        toolCallCount += 1;
        const effect = classifyToolEffect(call.toolId);
        const check = checkToolAgainstGrant({
          toolId: call.toolId,
          grant,
          effect,
        });
        if (!check.ok) {
          denials.push(check.reason ?? "tool_not_allowed");
          continue;
        }

        if (needsMutationApproval({ effect, grant })) {
          const invocationId = call.callId || `inv_${journal.length + 1}`;
          gate = {
            status: "suspended",
            kind: "mutation_approval_required",
            toolId: call.toolId,
            invocationId,
            reasonCodes: [
              "gate_mutation_approval_required",
              "approval_required",
            ],
          };
          reasonCodes.push(...gate.reasonCodes);
          ctx.store.setSlice("pendingMutationApproval", {
            toolId: call.toolId,
            invocationId,
            args: call.args,
          });
          break;
        }

        const idempotencyKey = buildIdempotencyKey({
          toolId: call.toolId,
          args: call.args,
        });
        const existing = findByIdempotencyKey(journal, idempotencyKey);
        if (existing?.status === "succeeded") continue;

        const invocationId = call.callId || `inv_${journal.length + 1}`;
        const now = new Date().toISOString();
        journal = appendToolInvocation(journal, {
          invocationId,
          toolId: call.toolId,
          idempotencyKey,
          status: "pending",
          inputHash: idempotencyKey,
          effectClass: effect === "mutate" ? "mutate" : "read",
          startedAt: now,
        });

        let status: "succeeded" | "failed" = "succeeded";
        if (deps.tools) {
          const result = await deps.tools.execute({
            toolId: call.toolId,
            args: call.args,
            grant,
            invocationId,
          });
          if (!result.ok) {
            status = "failed";
            if (result.reasonCode) denials.push(result.reasonCode);
          }
        }
        journal = settleToolInvocation(journal, {
          invocationId,
          status,
          finishedAt: new Date().toISOString(),
        });
        reasonCodes.push(
          ...applyTaskSettleToStore({
            store: ctx.store,
            args: call.args,
            effect,
            status,
          }),
        );
      }
    }
  }

  ctx.store.setSlice("toolJournal", journal);
  ctx.store.setSlice("lastAssistantText", assistantText);

  const softRails = evaluateSoftRails({
    repeatedToolCalls: toolCallCount,
    budgetUsedRatio: denials.length > 0 ? 0.5 : 0.1,
    wallTimeSoftMs: deps.wallTimeSoftMs,
  });

  const heartbeats = countTurnHeartbeats({
    startedAtMs: loopStartedAtMs,
    nowMs: Date.now(),
    intervalMs: deps.heartbeatIntervalMs,
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
