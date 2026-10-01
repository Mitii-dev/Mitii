import type { ModelMessage } from "../../../../modules/model-gateway";
import type { TokenEstimatorPort } from "../../../../modules/prompt-construction";
import type { WindowPolicy } from "../../../../modules/window-budget";
import type { RequestMetaCommand } from "../../../../modules/request-intake";

import { SESSION_CONTROL_HELP_TEXT } from "./constants";
import { forceCompactConversation } from "./forceCompactConversation";
import type { SessionControlResult } from "./types";

export interface HandleMetaCommandInput {
  meta: RequestMetaCommand;
  conversation?: readonly ModelMessage[];
  estimator: TokenEstimatorPort;
  windowPolicy?: WindowPolicy;
  sessionId?: string;
}

/**
 * Dispatch an intake-classified meta command.
 * Pure relative to host storage — returns structured hints for the host/engine.
 */
export function handleMetaCommand(
  input: HandleMetaCommandInput,
): SessionControlResult {
  const { meta } = input;
  const name = meta.name.toLowerCase();

  switch (name) {
    case "stop":
      return {
        command: "stop",
        lifecycle: meta.lifecycle,
        status: "cancelled",
        answer: "Stopped.",
        reasonCodes: ["session_control_stop"],
        warnings: [],
        error: {
          code: "cancelled",
          message: "Meta command /stop cancelled the run at intake.",
        },
      };

    case "new":
    case "clear":
      return {
        command: name,
        lifecycle: meta.lifecycle,
        status: "completed",
        answer:
          name === "new"
            ? "Starting a new chat. Clear the prior session transcript on the host."
            : "Chat cleared. Discard the prior session transcript on the host.",
        reasonCodes: ["session_control_finalized"],
        warnings: [],
        sessionAction: name === "new" ? "new" : "clear",
      };

    case "compact": {
      const forced = forceCompactConversation({
        messages: input.conversation ?? [],
        estimator: input.estimator,
        windowPolicy: input.windowPolicy,
      });
      if ((input.conversation?.length ?? 0) === 0) {
        return {
          command: "compact",
          lifecycle: meta.lifecycle,
          status: "completed",
          answer: "Nothing to compact — conversation is empty.",
          reasonCodes: ["session_control_compacted"],
          warnings: ["session_control:compact:empty"],
          compactStats: forced.stats,
          compactedConversation: [],
        };
      }
      if (!forced.compacted) {
        return {
          command: "compact",
          lifecycle: meta.lifecycle,
          status: "completed",
          answer: `Conversation already compact (${forced.stats.beforeMessages} messages).`,
          reasonCodes: ["session_control_compacted"],
          warnings: [],
          compactStats: forced.stats,
          compactedConversation: forced.messages,
        };
      }
      return {
        command: "compact",
        lifecycle: meta.lifecycle,
        status: "completed",
        answer: `Compacted conversation from ${forced.stats.beforeMessages} to ${forced.stats.afterMessages} messages (omitted ~${forced.stats.omittedTokens} tokens). Host should replace the session transcript.`,
        reasonCodes: ["session_control_compacted"],
        warnings: [
          `session_control:compact:${forced.stats.beforeMessages}->${forced.stats.afterMessages}`,
        ],
        compactStats: forced.stats,
        compactedConversation: forced.messages,
      };
    }

    case "help":
      return {
        command: "help",
        lifecycle: meta.lifecycle,
        status: "completed",
        answer: SESSION_CONTROL_HELP_TEXT,
        reasonCodes: ["session_control_side_channel"],
        warnings: [],
      };

    case "status":
      return {
        command: "status",
        lifecycle: meta.lifecycle,
        status: "completed",
        answer: [
          "Session control status:",
          `  sessionId: ${input.sessionId ?? "(none)"}`,
          `  conversationMessages: ${input.conversation?.length ?? 0}`,
          `  windowTokens: ${input.windowPolicy?.contextWindowTokens ?? "(default)"}`,
        ].join("\n"),
        reasonCodes: ["session_control_side_channel"],
        warnings: [],
      };

    case "resume":
      return {
        command: "resume",
        lifecycle: meta.lifecycle,
        status: "completed",
        answer: meta.args.trim()
          ? `Resume requested for session "${meta.args.trim()}". Host should load that session and start a continue turn.`
          : "Resume requested. Pass a session id: /resume <sessionId>. Host owns session storage.",
        reasonCodes: ["session_control_side_channel"],
        warnings: meta.args.trim()
          ? [`session_control:resume:${meta.args.trim()}`]
          : ["session_control:resume:missing_id"],
      };

    default:
      return {
        command: name,
        lifecycle: meta.lifecycle,
        status: "completed",
        answer: `Unhandled meta command /${name}.`,
        reasonCodes: ["intake_meta_command"],
        warnings: [`session_control:unhandled:${name}`],
      };
  }
}
