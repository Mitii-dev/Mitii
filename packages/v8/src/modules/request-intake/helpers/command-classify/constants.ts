import type { MetaCommandLifecycle } from "../request-envelope/types";

export interface BuiltinMetaCommandSpec {
  name: string;
  lifecycle: MetaCommandLifecycle;
  acceptsArgs: boolean;
}

/**
 * Minimal Mitii meta-command table.
 * Intake classifies only — hosts/session-control execute side effects.
 */
export const BUILTIN_META_COMMAND_SPECS = [
  { name: "stop", lifecycle: "stop", acceptsArgs: false },
  { name: "new", lifecycle: "finalize", acceptsArgs: false },
  { name: "clear", lifecycle: "finalize", acceptsArgs: false },
  { name: "compact", lifecycle: "side_channel", acceptsArgs: false },
  { name: "help", lifecycle: "side_channel", acceptsArgs: false },
  { name: "status", lifecycle: "side_channel", acceptsArgs: false },
  { name: "resume", lifecycle: "side_channel", acceptsArgs: true },
] as const satisfies readonly BuiltinMetaCommandSpec[];

/** Leading tokens that resolve interaction mode instead of meta lifecycle. */
export const MODE_SLASH_COMMANDS = {
  ask: "ask",
  plan: "plan",
  agent: "agent",
} as const;
