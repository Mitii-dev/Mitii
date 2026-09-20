import type { ModelMessage } from "../../../../modules/model-gateway";

import {
  composeMitiiSystemContext,
  initializeSystemContext,
  reconcileSystemContext,
  SYSTEM_CONTEXT_SOURCE_KEYS,
  type ObservedContextSourceValues,
  type SystemContextSnapshot,
} from "../system-context";
import {
  extractBaselineSystemText,
  hashContextText,
  initializeContextEpoch,
  isMidConversationSystemContent,
  markContextEpochForReplacement,
  normalizeContextEpochSnapshot,
  replaceContextEpoch,
  wrapMidConversationSystemText,
} from "./ContextEpoch";
import type { ContextEpoch, ContextEpochAdmitResult } from "./types";

export interface AdmitContextEpochInput {
  readonly runId: string;
  readonly messages: ModelMessage[];
  readonly previous: ContextEpoch | undefined;
  readonly compactionApplied: boolean;
  readonly nowMs: number;
  readonly observed: ObservedContextSourceValues;
}

/**
 * OpenCode Context Epoch admission at a Safe Provider-Turn Boundary.
 *
 * Formulae:
 * 1. Initialize → freeze baseline verbatim; pin as cache prefix.
 * 2. Unchanged → pin baseline; no mid message.
 * 3. Updated → pin baseline; admit Mid-Conversation System Message; advance snapshot.
 * 4. Compaction / route change → replace generation; strip prior mid messages;
 *    pin fresh baseline.
 * 5. Unavailable admitted sources during replace → replace_blocked (keep epoch).
 */
export function admitContextEpoch(
  input: AdmitContextEpochInput,
): ContextEpochAdmitResult | undefined {
  const liveBaseline = extractBaselineSystemText(input.messages);
  if (!liveBaseline && !input.previous) {
    return undefined;
  }

  const context = composeMitiiSystemContext(input.observed);
  const routeChanged =
    input.previous !== undefined &&
    routeFromSnapshot(toSnapshot(input.previous)) !== input.observed.route;

  if (!input.previous) {
    if (!liveBaseline) {
      return undefined;
    }
    const init = initializeSystemContext(context, liveBaseline);
    if (init.kind === "blocked") {
      return undefined;
    }
    const epoch = initializeContextEpoch({
      runId: input.runId,
      baselineSystemText: init.generation.baseline,
      sources: init.generation.snapshot,
      nowMs: input.nowMs,
    });
    return {
      epoch,
      pinBaseline: epoch.baselineSystemText,
      midConversationText: undefined,
      stripPriorMidConversation: false,
    };
  }

  let epoch = input.previous;
  const forceReplace = input.compactionApplied || routeChanged;
  if (input.compactionApplied) {
    epoch = markContextEpochForReplacement(epoch);
  }

  const previousSnapshot = toSnapshot(epoch);
  const reconciled = reconcileSystemContext({
    context,
    previous: previousSnapshot,
    forceReplace: forceReplace || epoch.replacementRequested,
    baselineOverride: liveBaseline ?? epoch.baselineSystemText,
  });

  switch (reconciled.kind) {
    case "unchanged":
      return {
        epoch,
        pinBaseline: epoch.baselineSystemText,
        midConversationText: undefined,
        stripPriorMidConversation: false,
      };
    case "updated": {
      const next: ContextEpoch = {
        ...epoch,
        structuredSnapshot: { sources: reconciled.snapshot },
      };
      return {
        epoch: next,
        pinBaseline: epoch.baselineSystemText,
        midConversationText: wrapMidConversationSystemText(reconciled.text),
        stripPriorMidConversation: false,
      };
    }
    case "replace_blocked":
      return {
        epoch,
        pinBaseline: epoch.baselineSystemText,
        midConversationText: undefined,
        stripPriorMidConversation: false,
      };
    case "replace_ready": {
      const baseline =
        reconciled.generation.baseline.trim().length > 0
          ? reconciled.generation.baseline
          : (liveBaseline ?? epoch.baselineSystemText);
      const replaced = replaceContextEpoch({
        previous: epoch,
        baselineSystemText: baseline,
        sources: reconciled.generation.snapshot,
        nowMs: input.nowMs,
      });
      return {
        epoch: replaced,
        pinBaseline: replaced.baselineSystemText,
        midConversationText: undefined,
        stripPriorMidConversation: true,
      };
    }
  }
}

function toSnapshot(epoch: ContextEpoch): SystemContextSnapshot {
  return normalizeContextEpochSnapshot(epoch.structuredSnapshot);
}

function routeFromSnapshot(snapshot: SystemContextSnapshot): string {
  const raw = snapshot[SYSTEM_CONTEXT_SOURCE_KEYS.route]?.value;
  if (!raw) {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

/** Pin the first non-mid system message to the immutable epoch baseline. */
export function pinBaselineSystemMessage(
  messages: ModelMessage[],
  baseline: string,
): { pinned: boolean; rewritten: boolean } {
  const index = messages.findIndex(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      !isMidConversationSystemContent(message.content),
  );
  if (index < 0) {
    messages.unshift({ role: "system", content: baseline });
    return { pinned: true, rewritten: true };
  }
  if (messages[index]!.content === baseline) {
    return { pinned: true, rewritten: false };
  }
  messages[index] = { ...messages[index]!, content: baseline };
  return { pinned: true, rewritten: true };
}

/** Remove prior Mid-Conversation System Messages from projected history. */
export function stripMidConversationSystemMessages(
  messages: ModelMessage[],
): number {
  let removed = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message?.role === "system" &&
      typeof message.content === "string" &&
      isMidConversationSystemContent(message.content)
    ) {
      messages.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Append a Mid-Conversation System Message after tool/user settlement and
 * before trailing working-set (caller orders upsertWorkingSet after this).
 */
export function appendMidConversationSystemMessage(
  messages: ModelMessage[],
  wrappedText: string,
): void {
  const last = messages[messages.length - 1];
  if (last?.role === "system" && last.content === wrappedText) {
    return;
  }
  messages.push({ role: "system", content: wrappedText });
}

export function baselinePrefixMatches(
  messages: readonly ModelMessage[],
  epoch: ContextEpoch,
): boolean {
  const live = extractBaselineSystemText(messages);
  if (!live) {
    return false;
  }
  return hashContextText(live) === epoch.baselineHash;
}
