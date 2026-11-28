/**
 * Detect sandbox / OS permission failures that are not product defects.
 * Used so Fix→Re-verify is not sealed for EPERM mkdtemp / listen noise.
 */

export function looksLikeEnvVerifyFailure(text: string | undefined): boolean {
  const blob = text?.trim() ?? "";
  if (blob.length === 0) return false;
  if (/\bEPERM\b/i.test(blob)) return true;
  if (/\boperation not permitted\b/i.test(blob)) return true;
  if (/\bmkdtemp\b/i.test(blob) && /\b(?:EPERM|not permitted|sandbox)\b/i.test(blob)) {
    return true;
  }
  if (/\blisten\b/i.test(blob) && /\b(?:EPERM|not permitted|127\.0\.0\.1)\b/i.test(blob)) {
    return true;
  }
  if (/\bsandbox\b/i.test(blob) && /\b(?:block|forbid|restrict|EPERM)\b/i.test(blob)) {
    return true;
  }
  return false;
}

/** Telemetry first-lines that must never become failure hints. */
export function isNoiseVerifyHint(text: string | undefined): boolean {
  const trimmed = text?.replace(/\s+/g, " ").trim() ?? "";
  if (trimmed.length === 0) return true;
  if (/^exit\s*code\b/i.test(trimmed)) return true;
  if (/^(?:✔|✗|✓|×)/.test(trimmed)) return true;
  if (/^\d+\s+passed\b/i.test(trimmed)) return true;
  if (/^>\s+\S+/.test(trimmed)) return true; // package script banner
  return false;
}
