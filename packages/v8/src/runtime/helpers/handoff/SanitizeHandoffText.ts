/**
 * Strip secret-like tokens from handoff summaries (F08).
 * Never dump raw tool output / env values into Briefcase.
 */

const SECRET_PATTERN =
  /\b(?:api[_-]?key|password|secret|token|bearer)\s*[:=]\s*\S+/gi;

const LONG_HEX = /\b[a-f0-9]{32,}\b/gi;

export function sanitizeHandoffText(raw: string, maxChars = 480): string {
  const cleaned = raw
    .replace(SECRET_PATTERN, "[redacted]")
    .replace(LONG_HEX, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 1))}…`;
}
