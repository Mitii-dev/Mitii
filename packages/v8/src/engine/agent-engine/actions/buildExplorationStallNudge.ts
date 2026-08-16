/**
 * Mid-loop circuit breaker copy when the run is re-reading the same files.
 */
export function buildExplorationStallNudge(snapshot: {
  fileReadCalls: number;
  uniqueFilePathsTouched: number;
}): string {
  return [
    `You are re-reading the same files without new information (${snapshot.fileReadCalls} reads / ${snapshot.uniqueFilePathsTouched} unique paths).`,
    "Stop re-reading. Use the observations you already have.",
    "If you can finish the task, do it now. If you cannot, give a final answer instead of another read.",
  ].join("\n");
}
