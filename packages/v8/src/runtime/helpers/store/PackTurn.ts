import { toModelToolSurface } from "../../tools/ToModelToolSurface";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";

export interface PackTurnInput {
  systemPrefix?: string;
  messages: Array<{ role: string; content: string }>;
  grant: GrantSurface;
  contextBundleSummary?: string;
}

export interface ModelRequestSketch {
  systemPrefix: string;
  messages: Array<{ role: string; content: string }>;
  tools: string[];
  reasonCodes: string[];
}

/**
 * Build a throwaway ModelRequest — tools always ⊆ grant (§11 / prompt⊆grant).
 */
export function packTurn(input: PackTurnInput): ModelRequestSketch {
  const tools = toModelToolSurface(input.grant);
  const messages = [...input.messages];
  if (input.contextBundleSummary) {
    messages.unshift({
      role: "system",
      content: input.contextBundleSummary,
    });
  }
  return {
    systemPrefix: input.systemPrefix ?? "",
    messages,
    tools,
    reasonCodes: ["pack_turn_grant_surface"],
  };
}
