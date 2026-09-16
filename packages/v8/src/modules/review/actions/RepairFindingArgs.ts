import {
  REVIEW_CATEGORIES,
  REVIEW_SEVERITIES,
} from "../constants";
import type {
  ReviewCategory,
  ReviewFinding,
  ReviewSeverity,
  ReviewWarning,
} from "../contracts";
import { reviewFindingSchema } from "../contracts";

/**
 * Repair and normalize raw model finding payloads (OCR args-repair inspired).
 * Accepts a single finding, an array, or a JSON string of either.
 */
export function repairFindingArgs(raw: unknown): {
  findings: ReviewFinding[];
  warnings: ReviewWarning[];
} {
  const warnings: ReviewWarning[] = [];
  let value = raw;

  if (typeof value === "string") {
    const repaired = repairJsonString(value);
    if (repaired.repaired) {
      warnings.push({
        code: "repair_applied",
        message: "Repaired stringified finding JSON.",
      });
    }
    try {
      value = JSON.parse(repaired.text) as unknown;
    } catch {
      warnings.push({
        code: "finding_truncated",
        message: "Could not parse finding JSON; dropping batch.",
      });
      return { findings: [], warnings };
    }
  }

  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "findings" in (value as object)
      ? (value as { findings: unknown }).findings
      : value && typeof value === "object" && "comments" in (value as object)
        ? (value as { comments: unknown }).comments
        : [value];

  if (!Array.isArray(list)) {
    return { findings: [], warnings };
  }

  const findings: ReviewFinding[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const candidate = {
      path: String(record.path ?? record.file ?? ""),
      content: String(
        record.content ??
          record.message ??
          record.body ??
          [
            typeof record.title === "string" ? record.title : "",
            typeof record.description === "string" ? record.description : "",
          ]
            .filter(Boolean)
            .join(": "),
      ),
      existingCode: String(
        record.existingCode ??
          record.existing_code ??
          record.anchor ??
          record.code ??
          "",
      ),
      suggestionCode:
        record.suggestionCode ?? record.suggestion_code
          ? String(record.suggestionCode ?? record.suggestion_code)
          : undefined,
      startLine: toPositiveInt(
        record.startLine ?? record.start_line ?? record.line,
      ),
      endLine: toPositiveInt(
        record.endLine ?? record.end_line ?? record.line,
      ),
      category: normalizeCategory(record.category),
      severity: normalizeSeverity(record.severity),
      anchored: false,
      groupId:
        typeof record.groupId === "string" ? record.groupId : undefined,
    };
    if (!candidate.existingCode && candidate.content) {
      candidate.existingCode = candidate.content.slice(0, 240);
    }
    const parsed = reviewFindingSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push({
        code: "finding_truncated",
        message: `Dropped invalid finding: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      });
      continue;
    }
    findings.push(parsed.data);
  }

  return { findings, warnings };
}

function repairJsonString(text: string): { text: string; repaired: boolean } {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    (trimmed.endsWith("}") || trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return { text: trimmed, repaired: false };
    } catch {
      // continue
    }
  }
  // Strip markdown fences
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    JSON.parse(fenced);
    return { text: fenced, repaired: fenced !== trimmed };
  } catch {
    return { text: fenced, repaired: true };
  }
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    return n > 0 ? n : undefined;
  }
  return undefined;
}

function normalizeCategory(value: unknown): ReviewCategory {
  const raw = String(value ?? "other").toLowerCase();
  return (REVIEW_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as ReviewCategory)
    : "other";
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  const raw = String(value ?? "low").toLowerCase();
  // Skill labels → severity
  if (raw === "blocker") return "critical";
  if (raw === "nit" || raw === "fyi") return "low";
  if (raw === "optional") return "medium";
  return (REVIEW_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as ReviewSeverity)
    : "low";
}
