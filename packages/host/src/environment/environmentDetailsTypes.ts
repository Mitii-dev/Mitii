/**
 * Host-collected IDE / session snapshot for Prompt Construction environment.
 * V8 stays host-neutral — apps fill this from VS Code / CLI.
 */
export interface WorkspaceEnvironmentSnapshot {
  /** Workspace-relative visible editor paths. */
  visibleFiles?: readonly string[];
  /** Workspace-relative open tab paths. */
  openTabs?: readonly string[];
  /** Short terminal summaries (busy/idle + last command). */
  terminalSummaries?: readonly string[];
  /** Compact git status / branch line. */
  gitStatusSummary?: string;
  /** Active Mitii mode reminder (ask|plan|agent or overlay slug). */
  modeReminder?: string;
  /** Recently modified relative paths (optional). */
  recentlyModifiedFiles?: readonly string[];
}

export const ENVIRONMENT_DETAILS_BLOCK_ID = "environment-details";
