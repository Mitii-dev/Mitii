/**
 * Minimal 5-field cron parser + next-fire (minute hour dom month dow).
 * Timezone support via Intl when provided; otherwise local machine TZ.
 */

const MONTH_NAMES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseCronField(
  token: string,
  min: number,
  max: number,
  names?: readonly string[],
): number[] {
  const results = new Set<number>();

  function resolveValue(raw: string): number {
    const lower = raw.toLowerCase();
    if (names) {
      const index = names.indexOf(lower);
      if (index !== -1) {
        return index + min;
      }
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`Invalid cron value "${raw}" for range [${min}-${max}]`);
    }
    return value;
  }

  for (const part of token.split(',')) {
    if (part === '*') {
      for (let value = min; value <= max; value += 1) {
        results.add(value);
      }
      continue;
    }

    const stepSeparator = part.indexOf('/');
    if (stepSeparator !== -1) {
      const rangePart = part.slice(0, stepSeparator);
      const step = Number(part.slice(stepSeparator + 1));
      if (!Number.isInteger(step) || step < 1) {
        throw new Error(`Invalid step in "${part}"`);
      }
      let from = min;
      let to = max;
      if (rangePart !== '*') {
        const dashIndex = rangePart.indexOf('-');
        if (dashIndex !== -1) {
          from = resolveValue(rangePart.slice(0, dashIndex));
          to = resolveValue(rangePart.slice(dashIndex + 1));
        } else {
          from = resolveValue(rangePart);
        }
      }
      if (from > to) {
        throw new Error(`Invalid cron range "${rangePart}"`);
      }
      for (let value = from; value <= to; value += step) {
        results.add(value);
      }
      continue;
    }

    const dashIndex = part.indexOf('-');
    if (dashIndex !== -1) {
      const from = resolveValue(part.slice(0, dashIndex));
      const to = resolveValue(part.slice(dashIndex + 1));
      if (from > to) {
        throw new Error(`Invalid cron range "${part}"`);
      }
      for (let value = from; value <= to; value += 1) {
        results.add(value);
      }
      continue;
    }

    results.add(resolveValue(part));
  }

  return [...results].sort((a, b) => a - b);
}

export function parseCron(pattern: string): ParsedCron {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron pattern "${pattern}": expected 5 fields (min hour dom month dow)`,
    );
  }
  return {
    minutes: parseCronField(fields[0]!, 0, 59),
    hours: parseCronField(fields[1]!, 0, 23),
    daysOfMonth: parseCronField(fields[2]!, 1, 31),
    months: parseCronField(fields[3]!, 1, 12, MONTH_NAMES),
    daysOfWeek: parseCronField(fields[4]!, 0, 6, DOW_NAMES),
  };
}

export function validateCronPattern(pattern: string): void {
  parseCron(pattern);
}

function partsInZone(date: Date, timezone?: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
} {
  if (!timezone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      dow: date.getDay(),
    };
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  const dowName = (bag.weekday ?? 'Sun').slice(0, 3).toLowerCase();
  const dow = DOW_NAMES.indexOf(dowName as (typeof DOW_NAMES)[number]);
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    dow: dow >= 0 ? dow : 0,
  };
}

function zonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone?: string,
): Date {
  if (!timezone) {
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  // Approximate: construct UTC guess then adjust using zone offset.
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const asUtc = new Date(utcGuess);
  const inZone = partsInZone(asUtc, timezone);
  const desiredAsMinutes =
    (((year * 12 + month) * 31 + day) * 24 + hour) * 60 + minute;
  const actualAsMinutes =
    (((inZone.year * 12 + inZone.month) * 31 + inZone.day) * 24 +
      inZone.hour) *
      60 +
    inZone.minute;
  const deltaMinutes = desiredAsMinutes - actualAsMinutes;
  return new Date(utcGuess + deltaMinutes * 60_000);
}

function matches(
  parsed: ParsedCron,
  month: number,
  day: number,
  dow: number,
  hour: number,
  minute: number,
): boolean {
  if (!parsed.months.includes(month)) return false;
  if (!parsed.hours.includes(hour)) return false;
  if (!parsed.minutes.includes(minute)) return false;
  const domMatch = parsed.daysOfMonth.includes(day);
  const dowMatch = parsed.daysOfWeek.includes(dow);
  const domStar = parsed.daysOfMonth.length === 31;
  const dowStar = parsed.daysOfWeek.length === 7;
  if (domStar && dowStar) return true;
  if (domStar) return dowMatch;
  if (dowStar) return domMatch;
  return domMatch || dowMatch;
}

/**
 * Next fire time strictly after `afterMs`.
 */
export function getNextCronTime(
  pattern: string,
  afterMs: number = Date.now(),
  timezone?: string,
): number {
  const parsed = parseCron(pattern);
  const start = new Date(afterMs + 60_000);
  start.setUTCSeconds(0, 0);
  // Search up to ~2 years of minutes — enough for monthly schedules.
  const cursor = new Date(start);
  for (let i = 0; i < 60 * 24 * 370 * 2; i += 1) {
    const p = partsInZone(cursor, timezone);
    if (
      matches(parsed, p.month, p.day, p.dow, p.hour, p.minute)
    ) {
      const candidate = zonedDate(
        p.year,
        p.month,
        p.day,
        p.hour,
        p.minute,
        timezone,
      ).getTime();
      if (candidate > afterMs) {
        return candidate;
      }
    }
    cursor.setTime(cursor.getTime() + 60_000);
  }
  throw new Error(`No next cron time found for "${pattern}"`);
}

export function getNextCronIso(
  pattern: string,
  afterMs: number = Date.now(),
  timezone?: string,
): string {
  return new Date(getNextCronTime(pattern, afterMs, timezone)).toISOString();
}
