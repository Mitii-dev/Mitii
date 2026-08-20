import { DEFAULT_MAX_TASKS, MAX_TASKS_CAP } from "./defaults";

/**
 * Resolve the live checklist cap. Window policy may raise it above the default
 * on large contexts, but never above MAX_TASKS_CAP.
 */
export function resolveMaxTasks(maxTasks?: number): number {
  if (maxTasks === undefined) {
    return DEFAULT_MAX_TASKS;
  }
  return Math.min(Math.max(DEFAULT_MAX_TASKS, Math.floor(maxTasks)), MAX_TASKS_CAP);
}

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
  /**
   * Never auto-advance Discover/Verify (or explore) process rows from a random
   * successful patch — those need real evidence / model patches.
   */
  autoAdvanceBlockedTitle: /^(discover|verify|explore|investigate)\b/i,
  /**
   * Change-like phase prefixes (optional). Concrete file-scoped titles without
   * a blocked prefix are also eligible.
   */
  autoAdvanceEligibleTitle: /^(change|implement|fix|build|apply)\b/i,
  autoAdvanceConcreteFileHint: /\.\w{1,16}\b|:\d{1,6}\b/,
  /**
   * Live checklist rows must name a concrete file (or line). Package-wide
   * mega-objectives are omitted — empty list is preferred over a fake one.
   */
  concreteDisplayHint: /\.\w{1,16}\b|:\d{1,6}\b/,
  /** Do not auto-complete remaining items when a run finishes. */
  stampAllDoneOnRunComplete: false,
  /**
   * Skill playbook / task-breakdown methodology lines that must not become live tasks.
   * Keep this catalog generic — no host, language, or repo names.
   */
  processMetaStep:
    /restate the goal|constraints from the spec|identify dependencies and risky areas|produce ordered tasks|with acceptance criteria|small enough to verify independently|clear done check|order respects dependencies|you have a spec|task feels too large|when not to use|do not write code during planning|operate in read-only mode|need to be parallelized|communicate scope to a human|implementable units|break (?:it|the (?:task|work)|this) (?:down|into)/i,
} as const;
