import type { MetaCommandLifecycle, RequestMetaCommand } from "../request-envelope/types";
import type { AgentMode } from "../interaction-mode/types";

import {
  BUILTIN_META_COMMAND_SPECS,
  MODE_SLASH_COMMANDS,
} from "./constants";
import {
  isLeadingSlashCommand,
  parseLeadingCommand,
} from "./parseLeadingCommand";

export type CommandClassifyResult =
  | {
      kind: "none";
      message: string;
    }
  | {
      kind: "mode";
      mode: AgentMode;
      message: string;
      messageOriginal: string;
    }
  | {
      kind: "meta";
      metaCommand: RequestMetaCommand;
      /** Remaining message for agent_turn* paths; empty for pure meta. */
      message: string;
      messageOriginal: string;
      /** True when lifecycle requires an agent turn. */
      entersAgentTurn: boolean;
    };

function lookupMetaSpec(name: string) {
  return BUILTIN_META_COMMAND_SPECS.find((spec) => spec.name === name);
}

/**
 * Classify a leading slash command into mode override, meta lifecycle, or none.
 * Does not execute commands.
 */
export function classifyLeadingCommand(
  sanitizedMessage: string,
): CommandClassifyResult {
  if (!isLeadingSlashCommand(sanitizedMessage)) {
    return { kind: "none", message: sanitizedMessage };
  }

  const parsed = parseLeadingCommand(sanitizedMessage);
  if (!parsed) {
    return { kind: "none", message: sanitizedMessage };
  }

  const mode = MODE_SLASH_COMMANDS[parsed.name as keyof typeof MODE_SLASH_COMMANDS];
  if (mode) {
    return {
      kind: "mode",
      mode,
      message: parsed.args,
      messageOriginal: sanitizedMessage,
    };
  }

  const spec = lookupMetaSpec(parsed.name);
  if (!spec) {
    // Unknown slash — leave text intact for the agent path.
    return { kind: "none", message: sanitizedMessage };
  }

  if (parsed.args.length > 0 && !spec.acceptsArgs) {
    return { kind: "none", message: sanitizedMessage };
  }

  const entersAgentTurn =
    (spec.lifecycle as MetaCommandLifecycle) === "agent_turn" ||
    ((spec.lifecycle as MetaCommandLifecycle) === "agent_turn_with_args" &&
      parsed.args.length > 0);

  return {
    kind: "meta",
    metaCommand: {
      name: spec.name,
      args: parsed.args,
      lifecycle: spec.lifecycle,
    },
    message: entersAgentTurn ? parsed.args : sanitizedMessage,
    messageOriginal: sanitizedMessage,
    entersAgentTurn,
  };
}
