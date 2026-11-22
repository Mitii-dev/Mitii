import type { ModelMessage } from "../../../modules/model-gateway";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { AgentReasonCode } from "../contracts";
import {
  isSessionHistoryCheckpointContent,
  looksReferentialSessionQuery,
  resolveSessionHistoryProjectionBudgetChars,
  retrieveSessionHistory,
  type InMemorySessionHistoryArchive,
} from "../internal/session-history";

/**
 * Dual-store cutover + hybrid recall under conversationShare.
 *
 * 1. Archive dropped turns (durable; leave model projection).
 * 2. Query = latest non-system user message.
 * 3. After drop OR referential follow-up: RRF hybrid retrieve → upsert checkpoint.
 */
export function applySessionHistoryHybrid(params: {
  runId: string;
  messages: ModelMessage[];
  archive: InMemorySessionHistoryArchive | undefined;
  droppedMessages: readonly ModelMessage[];
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  nowMs: number;
}): void {
  const archive = params.archive;
  if (!archive) {
    return;
  }

  if (params.droppedMessages.length > 0) {
    const archived = archive.archiveDroppedMessages({
      dropped: params.droppedMessages,
      nowMs: params.nowMs,
      runId: params.runId,
    });
    if (archived.length > 0) {
      params.reasonCodes.push("session_history_archived");
    }
  }

  if (archive.size() === 0) {
    return;
  }

  const query = extractLatestUserQuery(params.messages);
  if (!query) {
    return;
  }

  const justDropped = params.droppedMessages.length > 0;
  const referential = looksReferentialSessionQuery(query);
  if (!justDropped && !referential) {
    return;
  }

  const budgetChars = resolveSessionHistoryProjectionBudgetChars({
    conversationTokens: params.windowPolicy.sections.conversationTokens,
    droppedTurnSummaryChars:
      params.windowPolicy.compaction.droppedTurnSummaryChars,
  });

  const retrieved = retrieveSessionHistory({
    archive: archive.list(),
    query,
    budgetChars,
    force: justDropped,
  });

  if (!retrieved.projectionText || retrieved.hits.length === 0) {
    return;
  }

  params.reasonCodes.push("session_history_hybrid_retrieved");
  upsertSessionHistoryCheckpoint(params.messages, retrieved.projectionText);
  params.reasonCodes.push("session_history_projection_upserted");
}

function extractLatestUserQuery(
  messages: readonly ModelMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message?.role === "user" &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      !isSessionHistoryCheckpointContent(message.content) &&
      !message.content.includes("<working_set") &&
      !message.content.startsWith("[compacted prior context")
    ) {
      return message.content;
    }
  }
  return undefined;
}

function upsertSessionHistoryCheckpoint(
  messages: ModelMessage[],
  projectionText: string,
): void {
  const existing = messages.findIndex(
    (message) =>
      message.role === "user" &&
      isSessionHistoryCheckpointContent(message.content),
  );
  if (existing >= 0) {
    messages[existing] = { role: "user", content: projectionText };
    return;
  }
  // Insert after system / mid-conversation system messages (after
  // settlement, before trailing working set which upsertTrailingWorkingSet owns).
  let insertAt = 0;
  while (
    insertAt < messages.length &&
    messages[insertAt]?.role === "system"
  ) {
    insertAt += 1;
  }
  messages.splice(insertAt, 0, { role: "user", content: projectionText });
}
