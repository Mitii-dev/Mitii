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
import { applyTurnLoopMutationResume } from "../../helpers/turn/ApplyTurnLoopMutationResume";
import { resolveMaxPortTurns } from "../../helpers/turn/ResolveMaxPortTurns";
import {
  extractProcessExitCode,
  formatToolMessageContent,
  parseRecoveredArgs,
  previewToolOutput,
  recordToolSummary,
} from "../../helpers/turn/TurnLoopToolEventHelpers";
import {
  recoverLeakedToolCallsFromMarkup,
  summarizeToolCall,
} from "../../helpers/tool-recovery";
import {
  mergeRuntimeModelUsage,
  pushRuntimeModelStreamEvent,
  pushRuntimeModelTurnEvent,
  pushRuntimeToolCompletedEvent,
  pushRuntimeToolStartedEvent,
} from "../../helpers/events/PushRuntimeModelEvents";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type {
  RuntimeModelMessage,
  RuntimeModelUsage,
  RuntimeToolCall,
} from "../../ports/RuntimeModelPort";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import { checkToolAgainstGrant } from "../../tools/CheckToolAgainstGrant";
import { classifyToolEffect } from "../../tools/ClassifyToolEffect";
import { isGrantDenyReason } from "../../tools/GrantDenyReasons";
import type { TaskList } from "../../../modules/task-list";
import type { ContextBundleSketch } from "./9-EnrichContext";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";
import {
  softMutationNudgeMessage,
  buildForcedMutationNudgeMessage,
} from "../../helpers/loop-rails/mutation-nudge";
import {
  defaultGrantFromDecision,
  type TurnLoopGateSketch,
  type TurnLoopSketch,
} from "./10-TurnLoop";

/** Soft nudge after this many consecutive read-only tool turns on write routes. */
const SOFT_READONLY_TURNS_BEFORE_NUDGE = 3;

/**
 * Step 10 with injected model/tool ports — pack → model → after_tool hub → settle.
 * Mutate / expansion / budget walls go through evaluateGates (S11-LOOP).
 * Conversation accumulates across turns so tool results reach the next model call.
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
    ...(ctx.input.conversation?.length
      ? { conversation: ctx.input.conversation }
      : {}),
  });

  let journal =
    ctx.store.getSlice<ToolInvocationRecord[]>("toolJournal") ?? [];
  const denials: string[] = [];
  const reasonCodes = ["turn_loop_with_ports", ...packed.reasonCodes];
  let assistantText = "";
  let toolCallCount = 0;
  let modelCallCount = 0;
  let loopIterations = 0;
  let usageTotals: RuntimeModelUsage = {};
  let liveModelEvents = false;
  let liveContentDeltas = false;
  let liveToolEvents = false;
  const toolSummaries: NonNullable<TurnLoopSketch["toolSummaries"]> = [];
  let gate: TurnLoopGateSketch | undefined;
  const sink = deps.eventSink;

  const maxTurns = resolveMaxPortTurns(
    decision,
    grant,
    ctx.input.explorationDepth,
  );
  const writeCapable =
    grant.maximumWorkspaceEffect === "write" || decision?.route === "execute";
  const packedMessages: RuntimeModelMessage[] = [
    ...(packed.systemPrefix
      ? [{ role: "system" as const, content: packed.systemPrefix }]
      : []),
    ...packed.messages.map((m) => ({
      role: m.role as RuntimeModelMessage["role"],
      content: m.content,
    })),
  ];
  const resumed = applyTurnLoopMutationResume({
    getSlice: (k) => ctx.store.getSlice(k),
    setSlice: (k, v) => ctx.store.setSlice(k, v),
    packedMessages,
  });
  let messages = resumed.messages;
  if (resumed.resumed) reasonCodes.push("turn_loop_resume_after_mutation");

  if (deps.model) {
    let usedMutationTool = false;
    let readonlyToolTurns = 0;
    let softNudged = false;
    const effectiveMaxTurns = writeCapable ? maxTurns + 1 : maxTurns;
    for (let turn = 0; turn < effectiveMaxTurns; turn++) {
      if (ctx.store.isCancelling() || gate) break;
      if (ctx.abortSignal?.aborted || ctx.store.isCancelling()) break;

      if (
        writeCapable &&
        !usedMutationTool &&
        !softNudged &&
        readonlyToolTurns >= SOFT_READONLY_TURNS_BEFORE_NUDGE &&
        turn < maxTurns
      ) {
        messages.push({
          role: "user",
          content: softMutationNudgeMessage(readonlyToolTurns),
        });
        reasonCodes.push("turn_loop_soft_mutation_nudge");
        softNudged = true;
      }

      if (turn === maxTurns) {
        if (assistantText.trim().length > 0) break;
        if (!usedMutationTool) {
          messages.push({
            role: "user",
            content: buildForcedMutationNudgeMessage({}),
          });
          reasonCodes.push("turn_loop_mutation_nudge");
        }
      }

      const response = await deps.model.complete(
        {
          messages,
          tools: packed.tools,
          systemPrefix: packed.systemPrefix,
        },
        {
          abortSignal: ctx.abortSignal,
          onEvent: (event) => {
            if (!sink) return;
            if (
              event.type === "content_delta" ||
              event.type === "reasoning_delta"
            ) {
              liveContentDeltas = true;
            }
            liveModelEvents = true;
            pushRuntimeModelStreamEvent(sink, { runId, event });
          },
        },
      );
      modelCallCount += 1;
      loopIterations += 1;
      reasonCodes.push(...response.reasonCodes);
      assistantText = response.text;
      usageTotals = mergeRuntimeModelUsage(usageTotals, response.usage);

      if (sink) {
        liveModelEvents = true;
        pushRuntimeModelTurnEvent(sink, {
          runId,
          turnIndex: turn,
          usage: response.usage,
          finishReason:
            response.finishReason ??
            (response.toolCalls.length > 0 ? "tool_calls" : "stop"),
        });
      }

      let toolCalls = response.toolCalls;
      if (toolCalls.length === 0 && response.text.trim().length > 0) {
        const recovered = recoverLeakedToolCallsFromMarkup({
          content: response.text,
          allowedToolNames: new Set(packed.tools),
        });
        if (recovered.warnings.length > 0) {
          reasonCodes.push(
            ...recovered.warnings.map((w) => `leak_warn_${w.slice(0, 48)}`),
          );
        }
        if (recovered.toolCalls.length > 0) {
          toolCalls = recovered.toolCalls.map(
            (call): RuntimeToolCall => ({
              callId: call.id || `recovered_${journal.length + 1}`,
              toolId: call.name,
              args: parseRecoveredArgs(call.arguments),
            }),
          );
          reasonCodes.push(
            "turn_loop_recovered_leaked_tools",
            `turn_loop_recovered_${toolCalls.length}`,
          );
          // Do not keep leaked markup as the final answer once recovered.
          assistantText = "";
        }
      }

      if (toolCalls.length === 0) break;

      // Providers require assistant.tool_calls before role:tool results.
      // Drop co-emitted prose so a failed/empty follow-up cannot finish as
      // "We need to call…" mid-reasoning from this turn.
      assistantText = "";
      messages.push({
        role: "assistant",
        content:
          response.text.trim().length > 0
            ? response.text
            : `Calling tools: ${toolCalls.map((c) => c.toolId).join(", ")}`,
        toolCalls,
      });

      if (
        writeCapable &&
        !toolCalls.some((c) => classifyToolEffect(c.toolId) === "mutate")
      ) {
        readonlyToolTurns += 1;
      }

      for (const call of toolCalls) {
        toolCallCount += 1;
        const effect = classifyToolEffect(call.toolId);
        if (effect === "mutate") usedMutationTool = true;
        const invocationId = call.callId || `inv_${journal.length + 1}`;
        const summary =
          summarizeToolCall(call.toolId, call.args)?.trim() || undefined;
        if (summary) {
          recordToolSummary(toolSummaries, invocationId, { summary });
        }
        if (sink) {
          liveToolEvents = true;
          pushRuntimeToolStartedEvent(sink, {
            runId,
            callId: invocationId,
            toolName: call.toolId,
            ...(summary ? { summary } : {}),
          });
        }
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
              toolId: call.toolId,
              denyReason,
              enableExtendedGates: deps.enableExtendedGates === true,
            }),
            {
              toolId: call.toolId,
              invocationId,
            },
          );
          const denyPreview = (check.reason ?? "tool_not_allowed").slice(0, 1_000);
          recordToolSummary(toolSummaries, invocationId, {
            summary,
            reasonCode: denyPreview.slice(0, 80),
            outputPreview: denyPreview,
          });
          messages.push({
            role: "tool",
            toolCallId: invocationId,
            content: JSON.stringify({
              ok: false,
              reason: check.reason ?? "tool_not_allowed",
            }),
          });
          if (sink) {
            pushRuntimeToolCompletedEvent(sink, {
              runId,
              callId: invocationId,
              toolName: call.toolId,
              status: "failed",
              ...(summary ? { summary } : {}),
              reasonCode: denyPreview.slice(0, 80),
              outputPreview: denyPreview,
            });
          }
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
            toolId: call.toolId,
            needsExternalSideEffectApproval: effect === "external",
            enableExtendedGates: deps.enableExtendedGates === true,
          }),
          {
            toolId: call.toolId,
            invocationId,
          },
        );
        if (hubGate) {
          gate = hubGate;
          reasonCodes.push(...hubGate.reasonCodes);
          messages.push({
            role: "tool",
            toolCallId: invocationId,
            content: JSON.stringify({
              ok: false,
              reason: "pending_approval",
              toolId: call.toolId,
            }),
          });
          ctx.store.setSlice("pendingMutationApproval", {
            toolId: call.toolId,
            invocationId: hubGate.invocationId,
            args: call.args,
          });
          // Persist transcript so approve resume settles + continues (no rediscover).
          ctx.store.setSlice("turnLoopMessages", messages);
          recordToolSummary(toolSummaries, invocationId, {
            summary,
            reasonCode: "pending_approval",
            outputPreview: "pending_approval",
          });
          if (sink) {
            pushRuntimeToolCompletedEvent(sink, {
              runId,
              callId: invocationId,
              toolName: call.toolId,
              status: "skipped",
              ...(summary ? { summary } : {}),
              reasonCode: "pending_approval",
            });
          }
          break;
        }

        const settled = await settleToolCallWithCache({
          journal,
          toolCache,
          store: ctx.store,
          toolId: call.toolId,
          args: call.args,
          effect,
          invocationId,
          execute: deps.tools
            ? () =>
                deps.tools!.execute({
                  toolId: call.toolId,
                  args: call.args,
                  grant,
                  invocationId,
                })
            : undefined,
        });
        journal = settled.journal;
        reasonCodes.push(...settled.reasonCodes);
        if (settled.denial) denials.push(settled.denial);

        const cached =
          toolCache.get(invocationId) ??
          toolCache.getByContent(call.toolId, call.args);
        const toolOk = cached?.ok ?? settled.status === "succeeded";
        const failReason = settled.denial ?? cached?.reasonCode;
        const outputPreview = previewToolOutput(
          cached?.output,
          failReason,
          toolOk,
        );
        const processExitCode = extractProcessExitCode(cached?.output);
        recordToolSummary(toolSummaries, invocationId, {
          summary,
          ...(failReason ? { reasonCode: failReason.slice(0, 80) } : {}),
          ...(outputPreview ? { outputPreview } : {}),
          ...(typeof processExitCode === "number"
            ? { exitCode: processExitCode }
            : {}),
        });
        if (sink) {
          pushRuntimeToolCompletedEvent(sink, {
            runId,
            callId: invocationId,
            toolName: call.toolId,
            status: toolOk ? "succeeded" : "failed",
            ...(summary ? { summary } : {}),
            ...(failReason ? { reasonCode: failReason.slice(0, 80) } : {}),
            ...(outputPreview ? { outputPreview } : {}),
          });
        }
        messages.push({
          role: "tool",
          toolCallId: invocationId,
          content: formatToolMessageContent(cached?.output, {
            ok: toolOk,
            reason: failReason,
            status: settled.status,
          }),
        });
      }
    }

    // Ask/research: burn-out with no final text → prose synthesis (no tools).
    // Write/execute: mutation nudge above already kept tools; only fall back to
    // prose if still empty after that (never tell a write run to "stop tools").
    if (
      !gate &&
      !ctx.store.isCancelling() &&
      toolCallCount > 0 &&
      assistantText.trim().length === 0
    ) {
      const synthPrompt = writeCapable
        ? "A write was required but no patch was applied. Briefly explain what blocked the edit and the exact next tool call you would make."
        : "Stop calling tools. Using only the tool results already in this conversation, write a complete answer to the original user request now.";
      const synth = await deps.model.complete(
        {
          messages: [
            ...messages,
            {
              role: "user",
              content: synthPrompt,
            },
          ],
          tools: [],
          systemPrefix: packed.systemPrefix,
        },
        {
          abortSignal: ctx.abortSignal,
          onEvent: (event) => {
            if (!sink) return;
            if (
              event.type === "content_delta" ||
              event.type === "reasoning_delta"
            ) {
              liveContentDeltas = true;
            }
            liveModelEvents = true;
            pushRuntimeModelStreamEvent(sink, { runId, event });
          },
        },
      );
      modelCallCount += 1;
      loopIterations += 1;
      usageTotals = mergeRuntimeModelUsage(usageTotals, synth.usage);
      assistantText = synth.text;
      reasonCodes.push(
        writeCapable
          ? "turn_loop_forced_final_answer_after_mutation_nudge"
          : "turn_loop_forced_final_answer",
        ...synth.reasonCodes,
      );
      if (sink) {
        liveModelEvents = true;
        pushRuntimeModelTurnEvent(sink, {
          runId,
          turnIndex: loopIterations - 1,
          usage: synth.usage,
          finishReason: synth.finishReason ?? "stop",
        });
      }
      if (!assistantText.trim()) {
        reasonCodes.push("runtime_model_empty_answer");
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

  if (liveModelEvents) reasonCodes.push("runtime_live_model_events");
  if (liveContentDeltas) reasonCodes.push("runtime_live_content_deltas");
  if (liveToolEvents) reasonCodes.push("runtime_live_tool_events");

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
    modelCallCount,
    loopIterations,
    usageTotals,
    liveModelEvents,
    liveContentDeltas,
    liveToolEvents,
    ...(toolSummaries.length > 0 ? { toolSummaries } : {}),
    reasonCodes: [
      ...reasonCodes,
      ...denials.map((d) => `deny_${d}`),
      "turn_loop_hub_gates",
      `turn_loop_max_${maxTurns}`,
      `turn_loop_model_calls_${modelCallCount}`,
    ],
    gate,
  };
  ctx.store.setSlice("turnLoop", sketch);
  return sketch;
}
