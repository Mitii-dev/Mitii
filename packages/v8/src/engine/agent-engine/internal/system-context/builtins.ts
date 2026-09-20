/**
 * Built-in Context Sources for Mitii agent-engine epochs.
 * Formulae from OpenCode builtins (environment / instructions) adapted to
 * Mitii decision + instruction identity (ids), not drop-in Effect layers.
 */

import {
  decodeJsonString,
  decodeJsonStringArray,
  encodeJson,
  makeSystemContextSource,
  combineSystemContexts,
  emptySystemContext,
  type SystemContext,
} from "./SystemContext";
import type { SystemContextUnavailable } from "./types";
import { SYSTEM_CONTEXT_UNAVAILABLE } from "./types";

export const SYSTEM_CONTEXT_SOURCE_KEYS = {
  route: "system/route",
  planningDepth: "system/planning_depth",
  skills: "instructions/skills",
  rules: "instructions/rules",
  environment: "instructions/environment",
  memory: "instructions/memory",
} as const;

export interface ObservedContextSourceValues {
  readonly route: string;
  readonly planningDepth: string;
  readonly skillIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly environmentIds: readonly string[];
  readonly memoryIds: readonly string[];
  /**
   * When set, that source loads as Unavailable (stale-while-revalidate).
   * Keys are SYSTEM_CONTEXT_SOURCE_KEYS values.
   */
  readonly unavailableKeys?: ReadonlySet<string>;
}

function maybeUnavailable<A>(
  key: string,
  unavailableKeys: ReadonlySet<string> | undefined,
  value: A,
): A | SystemContextUnavailable {
  if (unavailableKeys?.has(key)) {
    return SYSTEM_CONTEXT_UNAVAILABLE;
  }
  return value;
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].map((id) => id.trim()).filter(Boolean).sort();
}

function formatIdList(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "(none)";
}

/**
 * Compose Mitii built-in sources for one Safe Provider-Turn Boundary observe.
 *
 * Route changes are treated as baseline-incompatible at the admit layer
 * (route is baked into Mitii core system text). Here route still has update
 * text for diagnostics; admit forces replace when route differs.
 */
export function composeMitiiSystemContext(
  observed: ObservedContextSourceValues,
): SystemContext {
  const unavailable = observed.unavailableKeys;
  const skillIds = sortedIds(observed.skillIds);
  const ruleIds = sortedIds(observed.ruleIds);
  const environmentIds = sortedIds(observed.environmentIds);
  const memoryIds = sortedIds(observed.memoryIds);

  return combineSystemContexts([
    emptySystemContext(),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.route,
      encode: encodeJson,
      decode: decodeJsonString,
      equivalent: (a, b) => a === b,
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.route,
          unavailable,
          observed.route,
        ),
      baseline: (route) => `Execution route: ${route || "(unset)"}.`,
      update: (_previous, route) =>
        `The execution route is now: ${route || "(unset)"}.`,
    }),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.planningDepth,
      encode: encodeJson,
      decode: decodeJsonString,
      equivalent: (a, b) => a === b,
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.planningDepth,
          unavailable,
          observed.planningDepth,
        ),
      baseline: (depth) => `Planning depth: ${depth || "(unset)"}.`,
      update: (_previous, depth) =>
        `Planning depth is now: ${depth || "(unset)"}.`,
    }),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.skills,
      encode: encodeJson,
      decode: decodeJsonStringArray,
      equivalent: (a, b) =>
        a.length === b.length && a.every((id, index) => id === b[index]),
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.skills,
          unavailable,
          skillIds,
        ),
      baseline: (ids) =>
        `Available skills for this agent: ${formatIdList(ids)}.`,
      update: (_previous, ids) =>
        `Available skills are now: ${formatIdList(ids)}.`,
      removed: () => "Previously loaded skills no longer apply.",
    }),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.rules,
      encode: encodeJson,
      decode: decodeJsonStringArray,
      equivalent: (a, b) =>
        a.length === b.length && a.every((id, index) => id === b[index]),
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.rules,
          unavailable,
          ruleIds,
        ),
      baseline: (ids) =>
        `Project instruction rules in effect: ${formatIdList(ids)}.`,
      update: (_previous, ids) =>
        `Project instruction rules are now: ${formatIdList(ids)}.`,
      removed: () => "Previously loaded project rules no longer apply.",
    }),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.environment,
      encode: encodeJson,
      decode: decodeJsonStringArray,
      equivalent: (a, b) =>
        a.length === b.length && a.every((id, index) => id === b[index]),
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.environment,
          unavailable,
          environmentIds,
        ),
      baseline: (ids) =>
        `Environment context blocks: ${formatIdList(ids)}.`,
      update: (_previous, ids) =>
        `Environment context blocks are now: ${formatIdList(ids)}.`,
      removed: () => "Previously loaded environment context no longer applies.",
    }),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.memory,
      encode: encodeJson,
      decode: decodeJsonStringArray,
      equivalent: (a, b) =>
        a.length === b.length && a.every((id, index) => id === b[index]),
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.memory,
          unavailable,
          memoryIds,
        ),
      baseline: (ids) => `Memory instruction blocks: ${formatIdList(ids)}.`,
      update: (_previous, ids) =>
        `Memory instruction blocks are now: ${formatIdList(ids)}.`,
      removed: () => "Previously loaded memory instructions no longer apply.",
    }),
  ]);
}
