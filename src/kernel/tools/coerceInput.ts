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

/**
 * Some models send numeric params as strings ("3" instead of 3), or pass 0/negative
 * meaning "no limit" instead of omitting the field. Coerce to a number and drop
 * non-positive values so the schema default applies instead of hard-failing the call.
 */
export function coercePositiveInt(value: unknown): number | unknown {
  let normalized = value;
  if (typeof normalized === 'string') {
    const parsed = Number(normalized.trim());
    if (Number.isFinite(parsed)) normalized = parsed;
  }
  if (typeof normalized === 'number' && (!Number.isFinite(normalized) || normalized <= 0)) {
    return undefined;
  }
  return normalized;
}

export const positiveInt = (max?: number) => {
  const schema = max ? z.number().int().positive().max(max) : z.number().int().positive();
  return z.preprocess(coercePositiveInt, schema.optional());
};

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

  // propose_file_scope: models occasionally misspell `objective` (e.g. "objecive") or send
  // the candidate list under a different field name ("candidatePaths"/"paths"). Repair these
  // deterministically instead of failing schema validation and burning the turn's progress.
  if (toolName === 'propose_file_scope') {
    if (typeof obj.objective !== 'string') {
      const objectiveAlias = ['objecive', 'objectve', 'objectiv', 'goal', 'task'].find(
        (key) => typeof obj[key] === 'string'
      );
      if (objectiveAlias) {
        obj.objective = obj[objectiveAlias];
        delete obj[objectiveAlias];
      }
    }
    if (obj.candidates === undefined) {
      const candidatesAlias = ['candidatePaths', 'paths', 'pathCandidates', 'canidates', 'files'].find(
        (key) => obj[key] !== undefined
      );
      if (candidatesAlias) {
        obj.candidates = obj[candidatesAlias];
        delete obj[candidatesAlias];
      }
    }
  }

  return obj;
}
