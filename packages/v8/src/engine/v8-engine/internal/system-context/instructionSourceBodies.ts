/**
 * Budgeted body inject for context-epoch mid-updates (P2).
 * Memory bodies never use this path — they stay untrusted evidence / reinject.
 */

import { hashContextText } from "../context-epoch/ContextEpoch";

export const CONTEXT_EPOCH_BODY_POLICY = {
  /** Hard cap on mid-conversation update body (chars ≈ tokens×4). */
  midConversationUpdateMaxChars: 4_000,
  /** Cap across all block bodies for one source (skills / rules / env). */
  midConversationBodyPerSourceChars: 1_600,
  /** Cap for a single id's body snippet. */
  midConversationBodyPerBlockChars: 400,
} as const;

export type InstructionSourceKind = "skills" | "rules" | "environment";

export interface InstructionSourceState {
  readonly ids: string[];
  /** Content digest; changes when bodies change even if ids stay stable. */
  readonly digest: string;
}

export type InstructionBodiesByKind = Partial<
  Record<InstructionSourceKind, Readonly<Record<string, string>>>
>;

export function buildInstructionSourceState(
  ids: readonly string[],
  bodies: Readonly<Record<string, string>> | undefined,
): InstructionSourceState {
  const sorted = sortedIds(ids);
  return {
    ids: sorted,
    digest: digestInstructionBodies(sorted, bodies),
  };
}

export function instructionSourceStatesEquivalent(
  a: InstructionSourceState,
  b: InstructionSourceState,
): boolean {
  return (
    a.digest === b.digest &&
    a.ids.length === b.ids.length &&
    a.ids.every((id, index) => id === b.ids[index])
  );
}

export function encodeInstructionSourceState(
  state: InstructionSourceState,
): string {
  return JSON.stringify({ ids: state.ids, digest: state.digest });
}

/**
 * Decode current or legacy (string[]) snapshots for soft migration.
 * Legacy arrays become ids-only digests so content changes can still fire
 * updates once bodies are supplied on the next observe.
 */
export function decodeInstructionSourceState(
  raw: string,
): InstructionSourceState | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (!parsed.every((item) => typeof item === "string")) {
        return undefined;
      }
      const ids = sortedIds(parsed as string[]);
      return { ids, digest: digestInstructionBodies(ids, undefined) };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { ids?: unknown }).ids) &&
      typeof (parsed as { digest?: unknown }).digest === "string"
    ) {
      const ids = sortedIds((parsed as { ids: string[] }).ids);
      return {
        ids,
        digest: (parsed as { digest: string }).digest,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function formatInstructionSourceBaseline(params: {
  kind: InstructionSourceKind;
  state: InstructionSourceState;
  bodies?: Readonly<Record<string, string>>;
}): string {
  const header = baselineHeader(params.kind, params.state.ids);
  const bodyBlock = formatBudgetedBodies({
    ids: params.state.ids,
    previousIds: [],
    bodies: params.bodies,
    preferAddedOnly: false,
  });
  return bodyBlock ? `${header}\n\n${bodyBlock}` : header;
}

export function formatInstructionSourceUpdate(params: {
  kind: InstructionSourceKind;
  previous: InstructionSourceState;
  current: InstructionSourceState;
  bodies?: Readonly<Record<string, string>>;
}): string {
  const header = updateHeader(params.kind, params.current.ids);
  const bodyBlock = formatBudgetedBodies({
    ids: params.current.ids,
    previousIds: params.previous.ids,
    bodies: params.bodies,
    preferAddedOnly: true,
  });
  return bodyBlock ? `${header}\n\n${bodyBlock}` : header;
}

export function truncateMidConversationUpdateText(
  text: string,
  maxChars = CONTEXT_EPOCH_BODY_POLICY.midConversationUpdateMaxChars,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  if (maxChars <= 1) {
    return "…";
  }
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

function formatBudgetedBodies(params: {
  ids: readonly string[];
  previousIds: readonly string[];
  bodies: Readonly<Record<string, string>> | undefined;
  preferAddedOnly: boolean;
}): string | undefined {
  if (!params.bodies) {
    return undefined;
  }
  const previous = new Set(params.previousIds);
  const added = params.ids.filter((id) => !previous.has(id));
  const order =
    params.preferAddedOnly && added.length > 0
      ? [
          ...added,
          ...params.ids.filter((id) => previous.has(id)),
        ]
      : [...params.ids];

  const parts: string[] = [];
  let used = 0;
  const perBlock = CONTEXT_EPOCH_BODY_POLICY.midConversationBodyPerBlockChars;
  const perSource = CONTEXT_EPOCH_BODY_POLICY.midConversationBodyPerSourceChars;

  for (const id of order) {
    const raw = params.bodies[id]?.trim();
    if (!raw) {
      continue;
    }
    const clipped =
      raw.length > perBlock ? `${raw.slice(0, perBlock - 1)}…` : raw;
    const chunk = `### ${id}\n${clipped}`;
    if (used + chunk.length > perSource) {
      break;
    }
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function digestInstructionBodies(
  ids: readonly string[],
  bodies: Readonly<Record<string, string>> | undefined,
): string {
  const lines = ids.map((id) => {
    const body = bodies?.[id]?.trim() ?? "";
    return `${id}\0${body}`;
  });
  return hashContextText(lines.join("\n"));
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].map((id) => id.trim()).filter(Boolean).sort();
}

function formatIdList(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(", ") : "(none)";
}

function baselineHeader(kind: InstructionSourceKind, ids: readonly string[]): string {
  switch (kind) {
    case "skills":
      return `Available skills for this agent: ${formatIdList(ids)}.`;
    case "rules":
      return `Project instruction rules in effect: ${formatIdList(ids)}.`;
    case "environment":
      return `Environment context blocks: ${formatIdList(ids)}.`;
  }
}

function updateHeader(kind: InstructionSourceKind, ids: readonly string[]): string {
  switch (kind) {
    case "skills":
      return `Available skills are now: ${formatIdList(ids)}.`;
    case "rules":
      return `Project instruction rules are now: ${formatIdList(ids)}.`;
    case "environment":
      return `Environment context blocks are now: ${formatIdList(ids)}.`;
  }
}
