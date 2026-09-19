import type { WorkspaceEnvironmentSnapshot } from "./environmentDetailsTypes.js";
import { ENVIRONMENT_DETAILS_BLOCK_ID } from "./environmentDetailsTypes.js";

export interface EnvironmentInstructionBlock {
  id: string;
  title: string;
  content: string;
  priority: number;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_TABS = 20;
const DEFAULT_MAX_TERMINALS = 8;
const DEFAULT_PRIORITY = 300;

/**
 * Format a host environment snapshot into a Prompt Construction instruction block.
 * Returns undefined when the snapshot has no useful content.
 */
export function formatEnvironmentDetailsBlock(
  snapshot: WorkspaceEnvironmentSnapshot,
  options?: {
    maxFiles?: number;
    maxTabs?: number;
    maxTerminals?: number;
    priority?: number;
  },
): EnvironmentInstructionBlock | undefined {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTabs = options?.maxTabs ?? DEFAULT_MAX_TABS;
  const maxTerminals = options?.maxTerminals ?? DEFAULT_MAX_TERMINALS;
  const parts: string[] = [];

  if (snapshot.modeReminder?.trim()) {
    parts.push(`Active mode: ${snapshot.modeReminder.trim()}`);
  }

  const visible = clipList(snapshot.visibleFiles, maxFiles);
  if (visible.length > 0) {
    parts.push(`Visible files:\n${visible.map((p) => `- ${p}`).join("\n")}`);
  }

  const tabs = clipList(snapshot.openTabs, maxTabs);
  if (tabs.length > 0) {
    parts.push(`Open tabs:\n${tabs.map((p) => `- ${p}`).join("\n")}`);
  }

  const terminals = clipList(snapshot.terminalSummaries, maxTerminals);
  if (terminals.length > 0) {
    parts.push(
      `Terminals:\n${terminals.map((line) => `- ${line}`).join("\n")}`,
    );
  }

  if (snapshot.gitStatusSummary?.trim()) {
    parts.push(`Git:\n${snapshot.gitStatusSummary.trim()}`);
  }

  const recent = clipList(snapshot.recentlyModifiedFiles, maxFiles);
  if (recent.length > 0) {
    parts.push(
      `Recently modified:\n${recent.map((p) => `- ${p}`).join("\n")}`,
    );
  }

  if (parts.length === 0) {
    return undefined;
  }

  return {
    id: ENVIRONMENT_DETAILS_BLOCK_ID,
    title: "Workspace environment",
    content: parts.join("\n\n"),
    priority: options?.priority ?? DEFAULT_PRIORITY,
  };
}

function clipList(
  values: readonly string[] | undefined,
  max: number,
): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return values
    .map((value) => value.replace(/\\/g, "/").trim())
    .filter((value) => value.length > 0)
    .slice(0, max);
}
