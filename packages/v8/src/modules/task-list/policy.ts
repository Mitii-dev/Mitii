import { DEFAULT_MAX_TASKS } from "./defaults";

/**
 * Decision thresholds for the live task list.
 * The list is a compact working set, not a dump of every plan step.
 */
export const TASK_LIST_POLICY = {
  maxTasks: DEFAULT_MAX_TASKS,
  maxActiveItems: 1,
  /** Do not auto-complete remaining items when a run finishes. */
  stampAllDoneOnRunComplete: false,
  /**
   * Skill playbook / when-to-use lines that must not become live tasks.
   * Keep this catalog generic — no host, language, or repo names.
   */
  processMetaStep:
    /you have a spec|task feels too large|when not to use|do not write code during planning|operate in read-only mode|need to be parallelized|communicate scope to a human/i,
} as const;
