export const VERIFICATION_CRITIQUE_SEVERITIES = [
  "critical",
  "warning",
  "info",
] as const;

export type VerificationCritiqueSeverity =
  (typeof VERIFICATION_CRITIQUE_SEVERITIES)[number];

export const VERIFICATION_CRITIQUE_DECISIONS = [
  "approve",
  "reject",
  "uncertain",
] as const;

export type VerificationCritiqueDecision =
  (typeof VERIFICATION_CRITIQUE_DECISIONS)[number];

export interface VerificationCritiqueIssue {
  severity: VerificationCritiqueSeverity;
  message: string;
}

export interface VerificationCritiqueResult {
  decision: VerificationCritiqueDecision;
  issues: VerificationCritiqueIssue[];
  reasoning?: string;
  rawExcerpt?: string;
}

/**
 * Parse a VTCode-style LLM verification critique.
 * Decision keywords are advisory metadata only — callers must never use them
 * to override `decideVerificationGate`.
 */
export function parseVerificationCritique(
  text: string,
): VerificationCritiqueResult | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const fromJson = tryParseJsonCritique(trimmed);
  if (fromJson) {
    return fromJson;
  }

  const decision = parseDecision(trimmed);
  const issues = parseIssues(trimmed);
  const reasoning = parseReasoning(trimmed);

  if (decision === "uncertain" && issues.length === 0 && !reasoning) {
    return undefined;
  }

  return {
    decision,
    issues,
    ...(reasoning ? { reasoning } : {}),
    rawExcerpt: trimmed.slice(0, 500),
  };
}

function tryParseJsonCritique(
  text: string,
): VerificationCritiqueResult | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? text).trim();
  if (!candidate.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const decision = normalizeDecision(
      typeof parsed.decision === "string"
        ? parsed.decision
        : typeof parsed.Decision === "string"
          ? parsed.Decision
          : undefined,
    );
    const issuesRaw = parsed.issues ?? parsed.IssuesFound ?? parsed.issuesFound;
    const issues: VerificationCritiqueIssue[] = [];
    if (Array.isArray(issuesRaw)) {
      for (const item of issuesRaw) {
        if (typeof item === "string" && item.trim()) {
          issues.push({ severity: "warning", message: item.trim() });
          continue;
        }
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const message =
          typeof record.message === "string"
            ? record.message
            : typeof record.description === "string"
              ? record.description
              : undefined;
        if (!message?.trim()) continue;
        issues.push({
          severity: normalizeSeverity(
            typeof record.severity === "string" ? record.severity : undefined,
          ),
          message: message.trim().slice(0, 400),
        });
      }
    }
    const reasoning =
      typeof parsed.reasoning === "string"
        ? parsed.reasoning.trim().slice(0, 800)
        : typeof parsed.Reasoning === "string"
          ? parsed.Reasoning.trim().slice(0, 800)
          : undefined;
    if (decision === "uncertain" && issues.length === 0 && !reasoning) {
      return undefined;
    }
    return {
      decision,
      issues: issues.slice(0, 12),
      ...(reasoning ? { reasoning } : {}),
      rawExcerpt: text.slice(0, 500),
    };
  } catch {
    return undefined;
  }
}

function parseDecision(text: string): VerificationCritiqueDecision {
  const match = text.match(
    /\*{0,2}Decision\*{0,2}\s*:\s*\*{0,2}\s*(APPROVE|REJECT|UNCERTAIN)\b/i,
  );
  if (match?.[1]) {
    return normalizeDecision(match[1]);
  }
  if (/\bAPPROVE\b/i.test(text) && !/\bREJECT\b/i.test(text)) {
    return "approve";
  }
  if (/\bREJECT\b/i.test(text)) {
    return "reject";
  }
  return "uncertain";
}

function parseIssues(text: string): VerificationCritiqueIssue[] {
  const issues: VerificationCritiqueIssue[] = [];
  const linePattern =
    /^\s*(?:\d+\.\s*)?\[(critical|warning|info)\]\s*(.+)$/gim;
  for (const match of text.matchAll(linePattern)) {
    const message = match[2]?.trim();
    if (!message || /^none$/i.test(message)) continue;
    issues.push({
      severity: normalizeSeverity(match[1]),
      message: message.slice(0, 400),
    });
    if (issues.length >= 12) break;
  }
  return issues;
}

function parseReasoning(text: string): string | undefined {
  const match = text.match(
    /\*{0,2}Reasoning\*{0,2}\s*:\s*([\s\S]+?)(?:\n\s*\n|\n\s*\*{0,2}(?:Decision|Issues)|$)/i,
  );
  const reasoning = match?.[1]?.trim();
  return reasoning ? reasoning.slice(0, 800) : undefined;
}

function normalizeDecision(
  raw: string | undefined,
): VerificationCritiqueDecision {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "approve" || value === "approved" || value === "pass") {
    return "approve";
  }
  if (value === "reject" || value === "rejected" || value === "fail") {
    return "reject";
  }
  return "uncertain";
}

function normalizeSeverity(
  raw: string | undefined,
): VerificationCritiqueSeverity {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "critical" || value === "error") return "critical";
  if (value === "info" || value === "note") return "info";
  return "warning";
}

/** Format advisory warnings that never flip the verification gate. */
export function formatVerificationCritiqueWarnings(
  critique: VerificationCritiqueResult,
  gateAction: "accept" | "reject",
): string[] {
  const warnings: string[] = [];
  if (critique.decision === "reject" && gateAction === "accept") {
    warnings.push(
      "LLM verification critique advised REJECT (advisory only; evidence gate accepted).",
    );
  } else if (critique.decision === "approve" && gateAction === "reject") {
    warnings.push(
      "LLM verification critique advised APPROVE (advisory only; evidence gate rejected).",
    );
  } else if (critique.decision !== "uncertain") {
    warnings.push(
      `LLM verification critique: ${critique.decision.toUpperCase()} (advisory only).`,
    );
  }

  for (const issue of critique.issues) {
    warnings.push(
      `LLM critique [${issue.severity}]: ${issue.message}`,
    );
  }
  if (
    critique.issues.length === 0 &&
    critique.reasoning &&
    critique.decision === "uncertain"
  ) {
    warnings.push(`LLM critique: ${critique.reasoning.slice(0, 300)}`);
  }
  return warnings;
}
