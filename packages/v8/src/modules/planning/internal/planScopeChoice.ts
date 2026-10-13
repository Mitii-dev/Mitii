/**
 * Detect / resolve Plan findings + A/B/C scope fork so Engine can honor
 * the choice, bound discovery, and offer later campaign phases.
 */

export type PlanScopeId = "a" | "b" | "c";

export const PLAN_SCOPE_DEFS = {
  a: {
    id: "a" as const,
    optionId: "outcome:scope-a-focused",
    letter: "A",
    label: "Focused case hardening",
    detail:
      "Harden high-value cases (oracles, negative paths, HTTP contracts) without redesigning the harness.",
  },
  b: {
    id: "b" as const,
    optionId: "outcome:scope-b-corpus",
    letter: "B",
    label: "Corpus-wide quality bar",
    detail:
      "Raise the bar across weak cases (solutions/oracles) and CI/validate coverage beyond smoke.",
  },
  c: {
    id: "c" as const,
    optionId: "outcome:scope-c-architecture",
    letter: "C",
    label: "Runner / architecture changes",
    detail:
      "Redesign grading DSL, scoring, dry-run policy, or workspace change rules.",
  },
} as const;

export const PLAN_SCOPE_ORDER: readonly PlanScopeId[] = ["a", "b", "c"];

const SCOPE_OPTION_ID = /^outcome:scope-([abc])\b/i;

const SCOPE_LABEL =
  /(?:Focused case hardening|Corpus-wide quality bar|Runner\s*\/\s*architecture changes)/i;

/** Clarification line from resume amend, or chip label text. */
const SCOPE_CLARIFICATION_LINE =
  /Clarification:\s*(?:([ABC])\)\s*)?(?:Focused case hardening|Corpus-wide quality bar|Runner\s*\/\s*architecture)/im;

const FREE_TEXT_SCOPE =
  /(?:^|\n)\s*([ABC])\s*([).:]|\s*\+)\s*/im;

const SHORTHAND_SCOPE =
  /\b(?:(B)\s*\+\s*quality\s*gate|(A)\s*\+\s*quick\s*wins|(C)\s*\+\s*architecture)\b/i;

function letterToScopeId(letter: string | undefined): PlanScopeId | undefined {
  if (!letter) return undefined;
  const lower = letter.toLowerCase();
  if (lower === "a" || lower === "b" || lower === "c") {
    return lower;
  }
  return undefined;
}

function labelToScopeId(text: string): PlanScopeId | undefined {
  if (/Focused case hardening/i.test(text)) return "a";
  if (/Corpus-wide quality bar/i.test(text)) return "b";
  if (/Runner\s*\/\s*architecture/i.test(text)) return "c";
  return undefined;
}

function resolveScopeFromBlob(text: string): PlanScopeId | undefined {
  const option = text.match(SCOPE_OPTION_ID);
  if (option?.[1]) {
    return letterToScopeId(option[1]);
  }
  const clarification = text.match(SCOPE_CLARIFICATION_LINE);
  if (clarification) {
    return (
      letterToScopeId(clarification[1]) ?? labelToScopeId(clarification[0])
    );
  }
  const shorthand = text.match(SHORTHAND_SCOPE);
  if (shorthand) {
    return letterToScopeId(shorthand[1] ?? shorthand[2] ?? shorthand[3]);
  }
  if (FREE_TEXT_SCOPE.test(text) && SCOPE_LABEL.test(text)) {
    const free = text.match(FREE_TEXT_SCOPE);
    return letterToScopeId(free?.[1]);
  }
  return labelToScopeId(text);
}

export type PlanScopeChoiceParams = {
  query?: string;
  optionId?: string;
  outcomeNote?: string;
  label?: string;
  conversation?: readonly { role: string; content: string }[];
};

/** Which A/B/C scope the user already picked (most specific signal wins). */
export function resolvePlanScopeId(
  params: PlanScopeChoiceParams,
): PlanScopeId | undefined {
  if (params.optionId) {
    const fromOption = params.optionId.match(SCOPE_OPTION_ID);
    if (fromOption?.[1]) {
      return letterToScopeId(fromOption[1]);
    }
  }
  if (params.outcomeNote) {
    const fromNote =
      letterToScopeId(params.outcomeNote.match(/^\s*([ABC])\b/i)?.[1]) ??
      labelToScopeId(params.outcomeNote);
    if (fromNote) return fromNote;
  }
  if (params.label) {
    const fromLabel =
      letterToScopeId(params.label.match(/^\s*([ABC])\)/i)?.[1]) ??
      labelToScopeId(params.label);
    if (fromLabel) return fromLabel;
  }

  const blobs: string[] = [];
  if (params.query?.trim()) {
    blobs.push(params.query);
  }
  for (const message of params.conversation ?? []) {
    if (message.role === "user" && message.content.trim()) {
      blobs.push(message.content);
    }
  }
  // Prefer the latest user blob (resume clarification is usually last).
  for (let i = blobs.length - 1; i >= 0; i -= 1) {
    const resolved = resolveScopeFromBlob(blobs[i]!);
    if (resolved) return resolved;
  }
  return undefined;
}

export function hasResolvedPlanScopeChoice(
  params: PlanScopeChoiceParams,
): boolean {
  return resolvePlanScopeId(params) !== undefined;
}

/**
 * All scope ids already chosen in this thread (including the current pick).
 * Used to compute remaining campaign phases.
 */
export function collectCompletedPlanScopeIds(
  params: PlanScopeChoiceParams & { currentScopeId?: PlanScopeId },
): PlanScopeId[] {
  const found = new Set<PlanScopeId>();
  if (params.currentScopeId) {
    found.add(params.currentScopeId);
  }
  const current = resolvePlanScopeId(params);
  if (current) {
    found.add(current);
  }
  const blobs: string[] = [];
  if (params.query?.trim()) blobs.push(params.query);
  if (params.outcomeNote?.trim()) blobs.push(params.outcomeNote);
  if (params.label?.trim()) blobs.push(params.label);
  if (params.optionId?.trim()) blobs.push(params.optionId);
  for (const message of params.conversation ?? []) {
    if (message.role === "user" && message.content.trim()) {
      blobs.push(message.content);
    }
  }
  for (const blob of blobs) {
    const id = resolveScopeFromBlob(blob);
    if (id) found.add(id);
  }
  return PLAN_SCOPE_ORDER.filter((id) => found.has(id));
}
