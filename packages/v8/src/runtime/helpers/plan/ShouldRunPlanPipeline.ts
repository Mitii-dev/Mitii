/**
 * §6.1 — when Step 3A / plan pipeline runs.
 * route picks the job card; planningDepth picks whether/how 3A runs.
 */
export function shouldRunPlanPipeline(params: {
  route: string;
  planningDepth: string;
}): boolean {
  const route =
    params.route === "repository_answer" || params.route === "direct_answer"
      ? "answer"
      : params.route;

  if (route === "plan") {
    return true;
  }
  if (route === "execute") {
    return (
      params.planningDepth === "visible" ||
      params.planningDepth === "internal"
    );
  }
  // answer | clarify | diagnose — never 3A
  return false;
}
