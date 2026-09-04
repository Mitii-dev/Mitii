import type { AutomationEventEnvelope } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getPath(value: unknown, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = value;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function resolveFilterValue(
  event: AutomationEventEnvelope,
  filterKey: string,
): unknown {
  if (event.attributes && Object.hasOwn(event.attributes, filterKey)) {
    return event.attributes[filterKey];
  }
  if (event.payload && Object.hasOwn(event.payload, filterKey)) {
    return event.payload[filterKey];
  }
  const candidate = {
    eventId: event.eventId,
    eventType: event.eventType,
    source: event.source,
    subject: event.subject,
    occurredAt: event.occurredAt,
    workspaceRoot: event.workspaceRoot,
    dedupeKey: event.dedupeKey,
    attributes: event.attributes,
    payload: event.payload,
  };
  const direct = getPath(candidate, filterKey);
  if (direct !== undefined) return direct;
  if (event.attributes) {
    const fromAttributes = getPath(event.attributes, filterKey);
    if (fromAttributes !== undefined) return fromAttributes;
  }
  if (event.payload) {
    return getPath(event.payload, filterKey);
  }
  return undefined;
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((item) => matchesExpected(actual, item));
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => matchesExpected(item, expected));
  }
  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      matchesExpected(actual[key], value),
    );
  }
  return Object.is(actual, expected);
}

/**
 * Spec filters are a flat/nested JSON object. Keys may address envelope
 * fields, attributes, or payload paths (e.g. `conclusion`, `payload.action`).
 */
export function automationEventMatchesFilters(
  event: AutomationEventEnvelope,
  filters: Record<string, unknown> | undefined,
): boolean {
  if (!filters || Object.keys(filters).length === 0) return true;
  return Object.entries(filters).every(([key, expected]) =>
    matchesExpected(resolveFilterValue(event, key), expected),
  );
}

export function parseFiltersJson(
  raw: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
