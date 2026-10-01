/**
 * Built-in Context Sources for Mitii v8-engine epochs.
 * Formulae from OpenCode builtins (environment / instructions) adapted to
 * Mitii decision + instruction identity (ids + content digests), not drop-in
 * Effect layers. Memory stays ids-only (bodies are untrusted / reinject path).
 */

import {
  decodeJsonString,
  encodeJson,
  makeSystemContextSource,
  combineSystemContexts,
  emptySystemContext,
  type SystemContext,
} from "./SystemContext";
import type { SystemContextUnavailable } from "./types";
import { SYSTEM_CONTEXT_UNAVAILABLE } from "./types";
import {
  buildInstructionSourceState,
  decodeInstructionSourceState,
  encodeInstructionSourceState,
  formatInstructionSourceBaseline,
  formatInstructionSourceUpdate,
  instructionSourceStatesEquivalent,
  type InstructionBodiesByKind,
  type InstructionSourceState,
} from "./instructionSourceBodies";

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
   * Optional truncated bodies for mid-update rendering.
   * Never include memory bodies here (untrusted path).
   */
  readonly bodies?: InstructionBodiesByKind;
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
  const skillState = buildInstructionSourceState(
    observed.skillIds,
    observed.bodies?.skills,
  );
  const ruleState = buildInstructionSourceState(
    observed.ruleIds,
    observed.bodies?.rules,
  );
  const environmentState = buildInstructionSourceState(
    observed.environmentIds,
    observed.bodies?.environment,
  );
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
    makeSystemContextSource<InstructionSourceState>({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.skills,
      encode: encodeInstructionSourceState,
      decode: decodeInstructionSourceState,
      equivalent: instructionSourceStatesEquivalent,
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.skills,
          unavailable,
          skillState,
        ),
      baseline: (state) =>
        formatInstructionSourceBaseline({
          kind: "skills",
          state,
          bodies: observed.bodies?.skills,
        }),
      update: (previous, current) =>
        formatInstructionSourceUpdate({
          kind: "skills",
          previous,
          current,
          bodies: observed.bodies?.skills,
        }),
      removed: () => "Previously loaded skills no longer apply.",
    }),
    makeSystemContextSource<InstructionSourceState>({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.rules,
      encode: encodeInstructionSourceState,
      decode: decodeInstructionSourceState,
      equivalent: instructionSourceStatesEquivalent,
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.rules,
          unavailable,
          ruleState,
        ),
      baseline: (state) =>
        formatInstructionSourceBaseline({
          kind: "rules",
          state,
          bodies: observed.bodies?.rules,
        }),
      update: (previous, current) =>
        formatInstructionSourceUpdate({
          kind: "rules",
          previous,
          current,
          bodies: observed.bodies?.rules,
        }),
      removed: () => "Previously loaded project rules no longer apply.",
    }),
    makeSystemContextSource<InstructionSourceState>({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.environment,
      encode: encodeInstructionSourceState,
      decode: decodeInstructionSourceState,
      equivalent: instructionSourceStatesEquivalent,
      load: () =>
        maybeUnavailable(
          SYSTEM_CONTEXT_SOURCE_KEYS.environment,
          unavailable,
          environmentState,
        ),
      baseline: (state) =>
        formatInstructionSourceBaseline({
          kind: "environment",
          state,
          bodies: observed.bodies?.environment,
        }),
      update: (previous, current) =>
        formatInstructionSourceUpdate({
          kind: "environment",
          previous,
          current,
          bodies: observed.bodies?.environment,
        }),
      removed: () => "Previously loaded environment context no longer applies.",
    }),
    makeSystemContextSource({
      key: SYSTEM_CONTEXT_SOURCE_KEYS.memory,
      encode: encodeJson,
      decode: (raw) => {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            return undefined;
          }
          if (!parsed.every((item) => typeof item === "string")) {
            return undefined;
          }
          return parsed as string[];
        } catch {
          return undefined;
        }
      },
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
