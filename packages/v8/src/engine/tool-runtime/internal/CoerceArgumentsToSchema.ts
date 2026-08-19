import { z } from "zod";

/**
 * Models sometimes emit JSON where a schema-declared string is already an
 * object/array, or a boolean is the string "true"/"false". Coerce those
 * values before schema validation.
 */
export function coerceArgumentsToSchema(
  value: unknown,
  schema: z.ZodTypeAny,
): unknown {
  const unwrapped = unwrapSchema(schema);

  if (unwrapped instanceof z.ZodString) {
    if (typeof value === "object" && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (unwrapped instanceof z.ZodBoolean) {
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (lowered === "true") {
        return true;
      }
      if (lowered === "false") {
        return false;
      }
    }
    return value;
  }

  if (unwrapped instanceof z.ZodArray) {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item) =>
      coerceArgumentsToSchema(item, unwrapped.element),
    );
  }

  if (unwrapped instanceof z.ZodObject) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const shape = unwrapped.shape;
    const next: Record<string, unknown> = {
      ...(value as Record<string, unknown>),
    };
    for (const [key, childSchema] of Object.entries(shape)) {
      if (!(key in next)) {
        continue;
      }
      next[key] = coerceArgumentsToSchema(next[key], childSchema as z.ZodTypeAny);
    }
    return next;
  }

  if (unwrapped instanceof z.ZodRecord) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = coerceArgumentsToSchema(item, unwrapped.valueSchema);
    }
    return next;
  }

  if (unwrapped instanceof z.ZodTuple) {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item, index) =>
      coerceArgumentsToSchema(item, unwrapped.items[index] ?? z.any()),
    );
  }

  return value;
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  while (true) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodCatch
    ) {
      current = current._def.innerType;
      continue;
    }
    if (current instanceof z.ZodEffects) {
      current = current._def.schema;
      continue;
    }
    if (current instanceof z.ZodBranded || current instanceof z.ZodReadonly) {
      const inner =
        (current._def as { type?: z.ZodTypeAny; innerType?: z.ZodTypeAny }).type ??
        (current._def as { innerType?: z.ZodTypeAny }).innerType;
      if (!inner) {
        return current;
      }
      current = inner;
      continue;
    }
    return current;
  }
}
