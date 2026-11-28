import { AGENT_ENGINE_THRESHOLDS } from "../../../engine/v8-engine/legacy/policy";
import {
  isDegenerateRepeatedAnswer,
  isMidWorkAnalysisDump,
  isUnfinishedInvestigationAnswer,
} from "./AssistantTurnDetectors";

const RECOVERED_OMIT_ELLIPSIS = "…";
const RECOVERED_OMIT_FOOTER =
  "(omitted mid-work analysis; continue with tools)";

/** Paths, diagnostics, and outcome crumbs worth keeping from a dump middle. */
const RECOVERED_KEEP_SIGNAL =
  /\b[\w./@+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|py|go|rs|java|kt|swift|md|json|yml|yaml|css|scss)\b|\bTS\d{3,5}\b|\berror\s+TS\d*\b|\b(?:root\s+cause|remaining\s+errors?|fixed|updated|changed|patched|cleared|removed|added)\b/i;

const RECOVERED_PLANNING_LINE =
  /^(?:okay[,.]?\s+|ok[,.]?\s+)?(?:let me|i(?:'ll| will)|i(?:'m| am) going to|i need to|i should|here(?:'|’)s my (?:plan|final plan))\b/i;

function isRecoveredKeepWorthyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 12 || trimmed.length > 220) {
    return false;
  }
  if (!RECOVERED_KEEP_SIGNAL.test(trimmed)) {
    return false;
  }
  // Pure planning narration even if it mentions a path once — skip.
  if (
    RECOVERED_PLANNING_LINE.test(trimmed) &&
    !/\bTS\d{3,5}\b|\berror\s+TS/i.test(trimmed)
  ) {
    return false;
  }
  return true;
}

function sliceRecoveredHead(text: string, budget: number): string {
  if (budget <= 0 || text.length === 0) {
    return "";
  }
  if (text.length <= budget) {
    return text;
  }
  const raw = text.slice(0, budget);
  const lastBreak = Math.max(raw.lastIndexOf("\n"), raw.lastIndexOf(" "));
  if (lastBreak >= Math.floor(budget * 0.55)) {
    return raw.slice(0, lastBreak).trimEnd();
  }
  return raw.trimEnd();
}

function sliceRecoveredTail(text: string, budget: number): string {
  if (budget <= 0 || text.length === 0) {
    return "";
  }
  if (text.length <= budget) {
    return text;
  }
  const raw = text.slice(text.length - budget);
  const newline = raw.indexOf("\n");
  if (newline >= 0 && newline <= Math.floor(budget * 0.5)) {
    return raw.slice(newline + 1).trimStart();
  }
  const space = raw.indexOf(" ");
  if (space >= 0 && space <= Math.floor(budget * 0.35)) {
    return raw.slice(space + 1).trimStart();
  }
  return raw.trimStart();
}

/**
 * Prefer concrete paths / errors / outcomes from the omitted middle so the
 * next turn does not lose the useful crumbs of a long planning dump.
 */
function extractRecoveredKeepLines(
  middle: string,
  budget: number,
  alreadyPresent: string,
): string {
  if (budget < 16 || middle.trim().length === 0) {
    return "";
  }
  const selected: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const line of middle.split("\n")) {
    if (!isRecoveredKeepWorthyLine(line)) {
      continue;
    }
    const trimmed = line.trim();
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    if (alreadyPresent.includes(trimmed)) {
      continue;
    }
    const cost = trimmed.length + (selected.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      continue;
    }
    seen.add(key);
    selected.push(trimmed);
    used += cost;
    if (selected.length >= 8) {
      break;
    }
  }
  return selected.join("\n");
}

/**
 * Keep mid-work analysis out of the live transcript so leftover output
 * tokens stay available for apply_patch instead of another essay.
 *
 * Dumps are compacted with head + high-signal middle crumbs + tail (not
 * head-only), so conclusions and concrete file/error notes survive.
 */
export function compactRecoveredAssistantContent(
  content: string,
  maxRecoveredAnalysisChars: number = AGENT_ENGINE_THRESHOLDS.maxRecoveredAnalysisChars,
): string {
  const text = content.trim();
  if (text.length === 0) {
    return text;
  }
  const dump =
    isMidWorkAnalysisDump(text) ||
    isUnfinishedInvestigationAnswer(text) ||
    isDegenerateRepeatedAnswer(text);
  if (!dump) {
    return text;
  }
  const maxChars = Math.max(32, Math.floor(maxRecoveredAnalysisChars));
  if (text.length <= maxChars) {
    return text;
  }

  const footer = `\n${RECOVERED_OMIT_ELLIPSIS}\n${RECOVERED_OMIT_FOOTER}`;
  const budget = Math.max(1, maxChars - footer.length);

  // Tiny budgets: fall back to a short head prefix.
  if (budget < 64) {
    const head = sliceRecoveredHead(text, budget);
    const compacted = `${head}${footer}`;
    return compacted.length <= maxChars
      ? compacted
      : compacted.slice(0, Math.max(1, maxChars - 1)) + RECOVERED_OMIT_ELLIPSIS;
  }

  let headBudget = Math.floor(budget * 0.42);
  let tailBudget = Math.floor(budget * 0.42);
  let keepBudget = budget - headBudget - tailBudget;

  let head = sliceRecoveredHead(text, headBudget);
  let tail = sliceRecoveredTail(text, tailBudget);

  // If head/tail overlap, the text is short relative to budget — head only.
  if (head.length + tail.length >= text.length) {
    const only = sliceRecoveredHead(text, budget);
    return `${only}${footer}`.slice(0, maxChars);
  }

  const headEnd = head.length;
  const tailStart = text.length - tail.length;
  const middle =
    tailStart > headEnd ? text.slice(headEnd, tailStart) : "";
  const keep = extractRecoveredKeepLines(
    middle,
    keepBudget,
    `${head}\n${tail}`,
  );

  const sections = [head];
  if (keep.length > 0) {
    sections.push(RECOVERED_OMIT_ELLIPSIS, keep);
  }
  sections.push(RECOVERED_OMIT_ELLIPSIS, tail);
  let body = sections.join("\n");

  // Fit body into budget: drop keep first, then shrink head/tail evenly.
  if (body.length > budget) {
    body = [head, RECOVERED_OMIT_ELLIPSIS, tail].join("\n");
  }
  if (body.length > budget) {
    const shrink = body.length - budget;
    const shrinkHead = Math.ceil(shrink / 2);
    const shrinkTail = Math.max(0, shrink - shrinkHead);
    headBudget = Math.max(24, headBudget - shrinkHead);
    tailBudget = Math.max(24, tailBudget - shrinkTail);
    head = sliceRecoveredHead(text, headBudget);
    tail = sliceRecoveredTail(text, tailBudget);
    body = [head, RECOVERED_OMIT_ELLIPSIS, tail].join("\n");
  }
  if (body.length > budget) {
    body = sliceRecoveredHead(text, budget);
  }

  const compacted = `${body}${footer}`;
  return compacted.length <= maxChars
    ? compacted
    : compacted.slice(0, Math.max(1, maxChars - 1)) + RECOVERED_OMIT_ELLIPSIS;
}
