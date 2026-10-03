import type {
  DecisionBrief,
  ExecutionDecision,
} from "../../../../modules/decision-policy";
import { compileDecisionBrief, MUTATION_TOOL_IDS } from "../../../../modules/decision-policy";
import type { ModelToolCall } from "../../../../modules/model-gateway";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";

import {
  evaluateMutationCritic,
  type MutationCriticResult,
} from "../../actions/evaluateMutationCritic";
import { extractMutationTargetPaths } from "../../actions/assertBatchReads";
import type { SteeringCriticMode } from "../../legacy/steeringFlags";

const MUTATION_OR_SHELL = new Set<string>([
  ...(MUTATION_TOOL_IDS as readonly string[]),
  "run_command",
]);

export type V8MutationCriticDecision =
  | { kind: "pass"; result: MutationCriticResult }
  | { kind: "revise"; result: MutationCriticResult; message: string }
  | { kind: "stop"; result: MutationCriticResult; message: string };

/**
 * Pre-mutation critic for v8-engine (narrow/pause only — never widen).
 * Modes: off | shadow (log only) | enforce.
 */
export function runV8MutationCritic(params: {
  decision: ExecutionDecision;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  mode: SteeringCriticMode;
  understanding?: RequestUnderstandingResult;
  brief?: DecisionBrief;
}): V8MutationCriticDecision {
  const mutationToolNames = params.toolCalls
    .map((call) => call.name)
    .filter((name) => MUTATION_OR_SHELL.has(name));

  if (params.mode === "off" || mutationToolNames.length === 0) {
    return {
      kind: "pass",
      result: { verdict: "pass", reasons: [], shadowWouldBlock: false },
    };
  }

  const intendedPaths: string[] = [];
  for (const call of params.toolCalls) {
    let args: unknown = call.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = undefined;
      }
    }
    intendedPaths.push(...extractMutationTargetPaths(call.name, args));
  }

  const brief =
    params.brief ??
    (params.understanding
      ? compileDecisionBrief({
          decision: params.decision,
          understanding: params.understanding,
        })
      : undefined);

  const askScopedPaths =
    params.understanding?.taskAnalysis.targets
      .filter(
        (t) =>
          t.explicit &&
          (t.kind === "file" || t.kind === "folder") &&
          t.value.length > 0,
      )
      .map((t) => t.value) ?? [];

  const result = evaluateMutationCritic({
    decision: params.decision,
    brief,
    mutationToolNames,
    intendedPaths,
    askScopedPaths,
    proposedSummary: params.turnContent.slice(0, 800),
    mode: params.mode,
  });

  if (result.verdict === "revise") {
    return {
      kind: "revise",
      result,
      message:
        `Mutation critic requires revision before applying edits:\n` +
        result.reasons.map((r) => `- ${r}`).join("\n") +
        `\nAdjust the plan or tool calls; do not widen authority.`,
    };
  }
  if (result.verdict === "stop_and_clarify") {
    return {
      kind: "stop",
      result,
      message:
        `Mutation critic blocked this mutation batch:\n` +
        result.reasons.map((r) => `- ${r}`).join("\n") +
        `\nDo not execute those mutations. Clarify or stay in-scope.`,
    };
  }
  return { kind: "pass", result };
}
