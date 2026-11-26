import { packTurnOrBriefcase } from "../../helpers/store/PackTurnOrBriefcase";
import { getOrCreateToolCallCache } from "../../helpers/store/ToolCallCache";
import { evaluateSoftRails } from "../../helpers/rails";
import { countTurnHeartbeats } from "../../helpers/heartbeat/CountTurnHeartbeats";
import type { ToolInvocationRecord } from "../../helpers/tool-journal";
import {
  evaluateAfterToolGate,
  evaluateOnBudgetGate,
  mapGateVerdictToTurnGate,
  resolveBudgetHardWall,
} from "../../helpers/turn";
import { settleToolCallWithCache } from "../../helpers/turn/SettleToolCallWithCache";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";
import { classifyToolEffect } from "../../tools/ClassifyToolEffect";
import { isGrantDenyReason } from "../../tools/GrantDenyReasons";
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
 * Step 10 with injected model/tool ports — pack → model → after_tool hub → settle.
 * Mutate / expansion / budget walls go through evaluateGates (S11-LOOP).
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
  const runId = ctx.store.getStore().runId;
  const toolCache = getOrCreateToolCallCache(ctx.store);
  const windowTokens =
    (ctx.store.getSlice<{ contextWindowTokens?: number }>("windowPolicy")
      ?.contextWindowTokens as number | undefined) ?? undefined;

  const packed = packTurnOrBriefcase({
    message: ctx.input.message,
    grant,
    decision,
    promptConstruction: deps.promptConstruction,
    contextBundleSummary: bundle?.summary,
    ...(bundle ? { contextBundle: bundle } : {}),
    ...(taskList ? { taskList } : {}),
    contextWindowTokens: windowTokens,
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
      if (ctx.abortSignal?.aborted || ctx.store.isCancelling()) break;

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
          const denyReason =
            check.reason && isGrantDenyReason(check.reason)
              ? check.reason
              : undefined;
          gate = mapGateVerdictToTurnGate(
            evaluateAfterToolGate({
              runId,
              mode: ctx.mode,
              route: decision?.route,
              effect,
              grant,
              denyReason,
              enableExtendedGates: deps.enableExtendedGates === true,
            }),
            {
              toolId: call.toolId,
              invocationId: call.callId || `inv_${journal.length + 1}`,
            },
          );
          if (gate) {
            reasonCodes.push(...gate.reasonCodes);
            break;
          }
          continue;
        }

        const hubGate = mapGateVerdictToTurnGate(
          evaluateAfterToolGate({
            runId,
            mode: ctx.mode,
            route: decision?.route,
            effect,
            grant,
            needsExternalSideEffectApproval: effect === "external",
            enableExtendedGates: deps.enableExtendedGates === true,
          }),
          {
            toolId: call.toolId,
            invocationId: call.callId || `inv_${journal.length + 1}`,
          },
        );
        if (hubGate) {
          gate = hubGate;
          reasonCodes.push(...hubGate.reasonCodes);
          ctx.store.setSlice("pendingMutationApproval", {
            toolId: call.toolId,
            invocationId: hubGate.invocationId,
            args: call.args,
          });
          break;
        }

        const settled = await settleToolCallWithCache({
          journal,
          toolCache,
          store: ctx.store,
          toolId: call.toolId,
          args: call.args,
          effect,
          invocationId: call.callId || `inv_${journal.length + 1}`,
          execute: deps.tools
            ? () =>
                deps.tools!.execute({
                  toolId: call.toolId,
                  args: call.args,
                  grant,
                  invocationId: call.callId || `inv_${journal.length + 1}`,
                })
            : undefined,
        });
        journal = settled.journal;
        reasonCodes.push(...settled.reasonCodes);
        if (settled.denial) denials.push(settled.denial);
      }
    }
  }

  ctx.store.setSlice("toolJournal", journal);
  ctx.store.setSlice("lastAssistantText", assistantText);

  const softRails = evaluateSoftRails({
    repeatedToolCalls: toolCallCount,
    budgetUsedRatio: denials.length > 0 ? 0.5 : 0.1,
    wallTimeSoftMs: deps.wallTimeSoftMs,
    elapsedMs: Date.now() - loopStartedAtMs,
  });

  if (!gate) {
    gate = mapGateVerdictToTurnGate(
      evaluateOnBudgetGate({
        runId,
        mode: ctx.mode,
        route: decision?.route,
        budgetHardWall: resolveBudgetHardWall({
          toolCallCount,
          maxToolCalls: decision?.toolGrant?.limits?.maxToolCalls,
          elapsedMs: Date.now() - loopStartedAtMs,
          wallTimeSoftMs: deps.wallTimeSoftMs,
        }),
        softRails,
      }),
    );
    if (gate) reasonCodes.push(...gate.reasonCodes);
  }

  const sketch: TurnLoopSketch = {
    cancelled: false,
    packedTools: packed.tools,
    softRails,
    journal,
    denials,
    heartbeats: countTurnHeartbeats({
      startedAtMs: loopStartedAtMs,
      nowMs: Date.now(),
      intervalMs: deps.heartbeatIntervalMs,
    }),
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
