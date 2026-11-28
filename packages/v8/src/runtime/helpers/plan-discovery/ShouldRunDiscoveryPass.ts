/**
 * When 3A.2 bounded discovery should run before plan draft (§6.2 / S3A-DISCOVER).
 */

export interface ShouldRunDiscoveryPassInput {
  mode?: "ask" | "plan" | "agent";
  route?: string;
  planningDepth?: string;
  /** Officer taskSize / taskBand. */
  taskSize?: string;
  explorationDepth?: "auto" | "quick" | "deep";
  /** Host / steer said targets already known. */
  skipDiscovery?: boolean;
}

export function shouldRunDiscoveryPass(
  input: ShouldRunDiscoveryPassInput,
): { run: boolean; reasonCodes: string[] } {
  if (input.skipDiscovery) {
    return { run: false, reasonCodes: ["discovery_skipped_host"] };
  }
  if (input.explorationDepth === "quick") {
    return { run: false, reasonCodes: ["discovery_skipped_quick"] };
  }
  if (input.mode === "plan" || input.route === "plan") {
    return { run: true, reasonCodes: ["discovery_required_plan_mode"] };
  }
  if (input.taskSize === "medium" || input.taskSize === "large") {
    return { run: true, reasonCodes: ["discovery_required_task_size"] };
  }
  if (input.planningDepth === "visible") {
    return { run: true, reasonCodes: ["discovery_required_visible"] };
  }
  if (input.planningDepth === "internal" && input.taskSize === "large") {
    return { run: true, reasonCodes: ["discovery_required_internal_large"] };
  }
  return { run: false, reasonCodes: ["discovery_not_required"] };
}
