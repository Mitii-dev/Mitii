/**
 * Reject titles that are verify telemetry / status residue, not work steppers.
 * Keeps finish answer-scraping from inventing "Exit code: 0" campaign rows.
 */

export function isEvidenceOrStatusTitle(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return true;

  if (/^exit\s*code\b/i.test(trimmed)) return true;
  if (/^\d+\s+passed\b/i.test(trimmed)) return true;
  if (/\b\d+\s+passed\b/i.test(trimmed) && /\b(?:failed|skipped)\b/i.test(trimmed)) {
    return true;
  }
  if (/^(?:passed|failed|skipped|blocked|ok|not ok)\b/i.test(trimmed)) {
    return true;
  }
  if (/^verified\b/i.test(trimmed)) return true;
  if (/^(?:✔|✗|✓|×)\s*/.test(trimmed)) return true;
  if (/^failed via\b/i.test(trimmed) || /^passed via\b/i.test(trimmed)) {
    return true;
  }
  if (/^could not run\b/i.test(trimmed)) return true;
  if (/^re-?run verification\b/i.test(trimmed)) return true;
  if (/^address verification failures\b/i.test(trimmed)) return true;
  return false;
}

/** True when every open/done title is evidence residue (junk desk). */
export function isEvidenceOnlyTaskTitles(
  titles: readonly string[],
): boolean {
  if (titles.length === 0) return false;
  return titles.every((title) => isEvidenceOrStatusTitle(title));
}
