/**
 * Mid-loop circuit breaker copy when the run is re-reading the same files.
 */
export function buildExplorationStallNudge(snapshot: {
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
}, options?: {
  mutationRequired?: boolean;
}): string {
  if (options?.mutationRequired) {
    return [
      `You are re-reading the same files without new information (${snapshot.fileReadCalls} reads / ${snapshot.uniqueFilePathsTouched} unique paths).`,
      "Stop re-reading. Use the observations you already have.",
      "This task requires workspace edits. Call apply_patch now for the smallest correct batch, then verify or continue with the next batch.",
      "If you truly cannot patch with the available context, state the blocker clearly; do not perform another read of the same paths.",
    ].join("\n");
  }

  return [
    `You are re-reading the same files without new information (${snapshot.fileReadCalls} reads / ${snapshot.uniqueFilePathsTouched} unique paths).`,
    "Stop re-reading. Use the observations you already have.",
    "If you can finish the task, do it now. If you cannot, give a final answer instead of another read.",
  ].join("\n");
}
