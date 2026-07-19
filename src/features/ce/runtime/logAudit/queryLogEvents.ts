/**
 * Targeted JSONL event query — capped, field-filtered, never unbounded.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { QueryLogEventsInput, QueryLogEventsResult } from './types';

const DEFAULT_LIMIT = 30;
const DEFAULT_MAX_CHARS = 8000;
const HARD_MAX_LIMIT = 100;
const HARD_MAX_CHARS = 24_000;

const DEFAULT_FIELDS = ['line', 'time', 'type', 'message', 'data'] as const;

export async function queryLogEvents(
  absolutePath: string,
  displayPath: string,
  input: Omit<QueryLogEventsInput, 'path'>
): Promise<QueryLogEventsResult> {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, HARD_MAX_LIMIT));
  const maxChars = Math.max(500, Math.min(input.maxChars ?? DEFAULT_MAX_CHARS, HARD_MAX_CHARS));
  const fields = new Set((input.fields?.length ? input.fields : [...DEFAULT_FIELDS]).map((f) => f.toLowerCase()));
  const typeFilter = input.filter?.type?.map((t) => t.toLowerCase());
  const toolFilter = input.filter?.tool?.toLowerCase();
  const successFilter = input.filter?.success;

  const events: Array<Record<string, unknown>> = [];
  let matched = 0;
  let lines = 0;
  let usedChars = 2; // []

  const rl = createInterface({
    input: createReadStream(absolutePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    lines += 1;
    const line = raw.trim();
    if (!line) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof event.type === 'string' ? event.type : 'unknown';
    const data = (event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const tool = String(data.tool ?? data.toolName ?? '').toLowerCase();

    if (typeFilter && typeFilter.length > 0 && !typeFilter.includes(type.toLowerCase())) {
      continue;
    }
    if (toolFilter && tool !== toolFilter && !String(event.message ?? '').toLowerCase().includes(toolFilter)) {
      continue;
    }
    if (successFilter !== undefined) {
      const success = data.success === true;
      if (success !== successFilter) continue;
    }

    matched += 1;
    if (events.length >= limit) continue;

    const projected = projectEvent(event, data, lines, fields);
    const encoded = JSON.stringify(projected);
    if (usedChars + encoded.length + (events.length > 0 ? 1 : 0) > maxChars) {
      break;
    }
    events.push(projected);
    usedChars += encoded.length + (events.length > 1 ? 1 : 0);
  }

  return {
    path: displayPath,
    matched,
    returned: events.length,
    truncated: matched > events.length,
    events,
  };
}

function projectEvent(
  event: Record<string, unknown>,
  data: Record<string, unknown>,
  line: number,
  fields: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.has('line')) out.line = line;
  if (fields.has('time') && typeof event.time === 'string') out.time = event.time;
  if (fields.has('type') && typeof event.type === 'string') out.type = event.type;
  if (fields.has('message') && typeof event.message === 'string') {
    out.message = String(event.message).slice(0, 500);
  }
  if (fields.has('data')) {
    out.data = compactData(data);
  }
  return out;
}

function compactData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      out[key] = value.slice(0, 400);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 10);
      continue;
    }
    if (typeof value === 'object') {
      try {
        out[key] = JSON.parse(JSON.stringify(value).slice(0, 600));
      } catch {
        out[key] = '[unserializable]';
      }
    }
  }
  return out;
}
