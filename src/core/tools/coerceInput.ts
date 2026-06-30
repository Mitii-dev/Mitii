import { z } from 'zod';

/** Some models send JSON arrays as strings — e.g. paths: '["a.ts","b.ts"]' */
export function coerceStringArray(value: unknown): string[] | unknown {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      // fall through
    }
  }

  if (trimmed.includes(',')) {
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }

  return [trimmed];
}

export const stringArray = (min = 1, max = 12) =>
  z.preprocess(coerceStringArray, z.array(z.string()).min(min).max(max));

export function normalizeToolInput(toolName: string, input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return input;
  }

  const obj = { ...(input as Record<string, unknown>) };
  const arrayFieldByTool: Record<string, string> = {
    read_files: 'paths',
    search_batch: 'queries',
  };

  const field = arrayFieldByTool[toolName];
  if (field && field in obj) {
    obj[field] = coerceStringArray(obj[field]);
  }

  // read_files: model sometimes sends singular "path"
  if (toolName === 'read_files' && !obj.paths && typeof obj.path === 'string') {
    obj.paths = coerceStringArray(obj.path);
    delete obj.path;
  }

  if (toolName === 'mark_step_complete') {
    if (!obj.stepId && typeof obj.step_id === 'string') {
      obj.stepId = obj.step_id;
      delete obj.step_id;
    }
    if (!obj.stepId && typeof obj.id === 'string') {
      obj.stepId = obj.id;
      delete obj.id;
    }
  }

  if (toolName === 'search' && typeof obj.query !== 'string' && typeof obj.pattern === 'string') {
    obj.query = obj.pattern;
    delete obj.pattern;
  }

  return obj;
}
