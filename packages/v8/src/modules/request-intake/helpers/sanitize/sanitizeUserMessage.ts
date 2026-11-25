/**
 * Sanitize raw user text at the intake boundary.
 * Trims, strips control characters / paste noise, does not rewrite meaning.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** Common terminal mouse / paste wrapper noise. */
const PASTE_NOISE = /\u001B\[[0-9;]*[A-Za-z]|\u001B\][^\u0007]*\u0007/g;
const SURROGATE_ORPHANS =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeUserMessage(raw: string): string {
  return raw
    .replace(PASTE_NOISE, "")
    .replace(CONTROL_CHARS, "")
    .replace(SURROGATE_ORPHANS, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}
