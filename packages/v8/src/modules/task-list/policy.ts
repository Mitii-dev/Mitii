import { DEFAULT_MAX_TASKS } from "./defaults";

/**
 * Decision thresholds for the live task list.
 * The list is a compact working set, not a dump of every plan step.
 */
export const TASK_LIST_POLICY = {
  maxTasks: DEFAULT_MAX_TASKS,
  maxActiveItems: 1,
  /** Prefer plan phases that describe concrete implementation or verification work. */
  preferredPhaseNames: /^(change|verify|implement|fix|build)$/i,
  /** Deprioritize discovery-only phases unless the plan contains no executable work. */
  deferredPhaseNames: /^(discover|explore|investigate)$/i,
  /** Soft-demote vague discovery intents. Process-meta matching below remains a hard skip. */
  deferredIntent:
    /inspect (?:current )?behavior|collect (?:impact|verification) evidence|bound failing surfaces|inspect failure evidence/i,
  /**
   * Engine/SDK default: mutating tools do not advance the list unless the
   * compose layer opts in. Host apps (VS Code/CLI) may enable auto-advance by
   * default for product UX. Auto-advance currently applies to built-in
   * workspace mutation tools only, not arbitrary MCP/custom tools.
   */
  autoAdvanceOnMutationSuccess: false,
  /** Do not auto-complete remaining items when a run finishes. */
  stampAllDoneOnRunComplete: false,
  /**
   * Skill playbook / task-breakdown methodology lines that must not become live tasks.
   * Keep this catalog generic — no host, language, or repo names.
   */
  processMetaStep:
    /restate the goal|constraints from the spec|identify dependencies and risky areas|produce ordered tasks|with acceptance criteria|small enough to verify independently|clear done check|order respects dependencies|you have a spec|task feels too large|when not to use|do not write code during planning|operate in read-only mode|need to be parallelized|communicate scope to a human|implementable units|break (?:it|the (?:task|work)|this) (?:down|into)/i,
} as const;
