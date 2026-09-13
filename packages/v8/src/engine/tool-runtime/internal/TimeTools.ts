/**
 * IANA timezone helpers for get_current_time / convert_time tools.
 * No external tz dependency — uses ECMAScript Intl + Date.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface TimeSnapshot {
  timezone: string;
  datetime: string;
  dayOfWeek: string;
  isDst: boolean;
}

export interface TimeConversionResult {
  source: TimeSnapshot;
  target: TimeSnapshot;
  timeDifference: string;
}

export class TimeToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeToolError";
  }
}

export function resolveLocalTimezoneId(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof resolved === "string" && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // fall through
  }
  return "UTC";
}

export function assertValidTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new TimeToolError(`Invalid IANA timezone: "${timezone}".`);
  }
}

export function getCurrentTime(timezone: string, now = new Date()): TimeSnapshot {
  assertValidTimezone(timezone);
  return snapshotInZone(now, timezone);
}

/**
 * Convert HH:MM (24h) on "today" in sourceTz into targetTz.
 */
export function convertTime(params: {
  sourceTimezone: string;
  time: string;
  targetTimezone: string;
  now?: Date;
}): TimeConversionResult {
  assertValidTimezone(params.sourceTimezone);
  assertValidTimezone(params.targetTimezone);
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(params.time.trim());
  if (!match) {
    throw new TimeToolError(
      `Invalid time format "${params.time}". Expected HH:MM (24-hour).`,
    );
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const now = params.now ?? new Date();

  const sourceParts = zonedParts(now, params.sourceTimezone);
  const sourceUtcMs = zonedWallTimeToUtcMs({
    year: sourceParts.year,
    month: sourceParts.month,
    day: sourceParts.day,
    hour,
    minute,
    timeZone: params.sourceTimezone,
  });
  const sourceDate = new Date(sourceUtcMs);
  const targetDate = sourceDate;

  const source = snapshotInZone(sourceDate, params.sourceTimezone);
  const target = snapshotInZone(targetDate, params.targetTimezone);
  const sourceOffsetMin = offsetMinutesAt(sourceDate, params.sourceTimezone);
  const targetOffsetMin = offsetMinutesAt(targetDate, params.targetTimezone);
  const hoursDifference = (targetOffsetMin - sourceOffsetMin) / 60;

  return {
    source,
    target,
    timeDifference: formatOffsetHours(hoursDifference),
  };
}

function snapshotInZone(date: Date, timezone: string): TimeSnapshot {
  const parts = zonedParts(date, timezone);
  const isoLocal = `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}T${pad(parts.hour, 2)}:${pad(parts.minute, 2)}:${pad(parts.second, 2)}`;
  const offset = formatOffsetString(offsetMinutesAt(date, timezone));
  return {
    timezone,
    datetime: `${isoLocal}${offset}`,
    dayOfWeek: DAY_NAMES[parts.weekday] ?? "Unknown",
    isDst: isDstAt(date, timezone),
  };
}

function zonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") {
      bag[part.type] = part.value;
    }
  }
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: weekdayMap[bag.weekday ?? ""] ?? 0,
  };
}

function offsetMinutesAt(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

function isDstAt(date: Date, timeZone: string): boolean {
  const jan = offsetMinutesAt(new Date(Date.UTC(date.getUTCFullYear(), 0, 1)), timeZone);
  const jul = offsetMinutesAt(new Date(Date.UTC(date.getUTCFullYear(), 6, 1)), timeZone);
  // Compare to January offset: when jan !== jul, DST is the non-January offset
  // for most northern-hemisphere zones.
  if (jan === jul) {
    return false;
  }
  const current = offsetMinutesAt(date, timeZone);
  return current !== jan;
}

/**
 * Binary-search wall time in zone → UTC ms (handles DST gaps/overlaps coarsely).
 */
function zonedWallTimeToUtcMs(params: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): number {
  let guess = Date.UTC(
    params.year,
    params.month - 1,
    params.day,
    params.hour,
    params.minute,
    0,
  );
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), params.timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wanted = Date.UTC(
      params.year,
      params.month - 1,
      params.day,
      params.hour,
      params.minute,
      0,
    );
    const delta = wanted - asUtc;
    if (delta === 0) {
      return guess;
    }
    guess += delta;
  }
  return guess;
}

function formatOffsetHours(hours: number): string {
  if (Number.isInteger(hours)) {
    return `${hours >= 0 ? "+" : ""}${hours.toFixed(1)}h`;
  }
  const trimmed = `${hours >= 0 ? "+" : ""}${hours.toFixed(2)}`.replace(
    /\.?0+$/,
    "",
  );
  return `${trimmed}h`;
}

function formatOffsetString(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${pad(h, 2)}:${pad(m, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
