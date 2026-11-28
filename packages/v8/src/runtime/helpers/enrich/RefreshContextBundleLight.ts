/**
 * Light refresh after mutation / grant expand / diagnostics ask (§11.2.2).
 * Does not reshuffle stable skills/rules — protects prompt cache.
 */

import {
  contextBundleSchema,
  type ContextBundle,
} from "../../contracts/enrich/ContextBundle";

export interface RefreshContextBundleLightInput {
  previous: ContextBundle;
  /** Newly in-scope or changed paths. */
  changedPaths?: readonly string[];
  diagnostics?: readonly string[];
  /** Optional fresh memory facts (semi-stable). */
  memoryFacts?: readonly string[];
}

export function refreshContextBundleLight(
  input: RefreshContextBundleLightInput,
): ContextBundle {
  const previous = input.previous;
  const changed = [...(input.changedPaths ?? [])]
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 24);
  const prevRepo = previous.repoContext?.items ?? [];
  const repoItems = [...new Set([...changed, ...prevRepo])].slice(0, 32);

  const diagnostics = [
    ...(input.diagnostics ?? []),
    ...(previous.diagnostics ?? []),
  ].slice(0, 32);

  const memoryItems =
    input.memoryFacts && input.memoryFacts.length > 0
      ? [...input.memoryFacts].slice(0, 24)
      : previous.memory?.items ?? [];

  const focusPaths = [
    ...new Set([...changed, ...previous.focusPaths]),
  ].slice(0, 24);

  const summary = [
    `route=${previous.route}`,
    `grant=${previous.grantProfile}`,
    focusPaths.length > 0
      ? `focus=${focusPaths.slice(0, 6).join(",")}`
      : "focus=none",
    `refresh=${changed.length}`,
  ].join("; ");

  return contextBundleSchema.parse({
    schemaVersion: 1,
    summary,
    focusPaths,
    route: previous.route,
    grantProfile: previous.grantProfile,
    enrichMode: "light",
    // Keep stable slices byte-stable when unchanged.
    ...(previous.projectRules ? { projectRules: previous.projectRules } : {}),
    ...(previous.skills ? { skills: previous.skills } : {}),
    ...(previous.decisionBrief
      ? { decisionBrief: previous.decisionBrief }
      : {}),
    ...(previous.planRef ? { planRef: previous.planRef } : {}),
    ...(previous.taskListPresent != null
      ? { taskListPresent: previous.taskListPresent }
      : {}),
    ...(memoryItems.length > 0
      ? {
          memory: {
            items: memoryItems,
            tokens: memoryItems.reduce(
              (n, s) => n + Math.ceil(s.length / 4),
              0,
            ),
            cacheClass: "semi",
            omissions: previous.memory?.omissions ?? [],
          },
        }
      : {}),
    ...(repoItems.length > 0
      ? {
          repoContext: {
            items: repoItems,
            tokens: repoItems.reduce((n, s) => n + Math.ceil(s.length / 4), 0),
            cacheClass: "volatile",
            omissions: previous.repoContext?.omissions ?? [],
          },
        }
      : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    reasonCodes: [
      "enrich_light_refresh",
      ...(changed.length > 0 ? ["enrich_changed_paths"] : []),
      ...(input.diagnostics && input.diagnostics.length > 0
        ? ["enrich_diagnostics_refresh"]
        : []),
    ],
  });
}
