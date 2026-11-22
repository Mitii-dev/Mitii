/**
 * Timestamp for Mitii log / artifact filenames.
 * Format: `MM-DD-YYYY-HH-MM` (24-hour clock).
 */
export function formatMitiiLogStamp(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day}-${year}-${hour}-${minute}`;
}

/**
 * Matches current 24h stamps and legacy `…-AM/PM-` filenames so existing
 * session logs still resume into the same file.
 */
export const MITII_LOG_STAMP_PREFIX =
  /^\d{2}-\d{2}-\d{4}-\d{2}-\d{2}(?:-(?:AM|PM))?-/;
