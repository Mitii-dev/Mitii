/**
 * Soft-prefer catalog skills from Officer taskSize / route.
 * Advisory only — never hard-required; missing catalog ids are ignored upstream.
 */

export const MEDIUM_PLANNING_SKILL_ID = "medium-planning" as const;

const PREFERRED_ROUTES = new Set(["plan", "execute"]);

/**
 * Prefer `medium-planning` when Officer says medium and the run is plan/execute.
 * Small does not prefer it. Large left for a later band (no forced L skill here).
 */
export function resolvePreferredSkillIdsForRun(params: {
  taskSize?: string;
  route?: string;
}): string[] {
  const route = params.route?.trim();
  if (route && !PREFERRED_ROUTES.has(route)) {
    return [];
  }
  if (params.taskSize === "medium") {
    return [MEDIUM_PLANNING_SKILL_ID];
  }
  return [];
}
