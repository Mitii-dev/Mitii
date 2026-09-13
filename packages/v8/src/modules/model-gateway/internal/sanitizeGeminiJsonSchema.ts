/**
 * Gemini `functionDeclarations[].parameters` / `responseSchema` accept an
 * OpenAPI 3.0 Schema subset — not full JSON Schema. Keywords like
 * `additionalProperties` cause HTTP 400 ("Unknown name … Cannot find field").
 *
 * Strip unsupported keys recursively so Mitii’s internal tool schemas (OpenAI-
 * style stubs and full schemas) can be sent without per-tool special cases.
 *
 * @see https://ai.google.dev/gemini-api/docs/function-calling
 */

const UNSUPPORTED_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "$comment",
  "definitions",
  "additionalProperties",
  "unevaluatedProperties",
  "patternProperties",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "not",
  "prefixItems",
  "contains",
  "contentEncoding",
  "contentMediaType",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "title",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "minimum",
  "maximum",
]);

const NESTED_OBJECT_KEYS = ["properties"] as const;
const NESTED_SCHEMA_ARRAY_KEYS = ["anyOf", "oneOf", "allOf"] as const;
const NESTED_SCHEMA_KEYS = ["items"] as const;

/**
 * Deep-clone a JSON-schema-like value into a Gemini-safe OpenAPI subset.
 * Non-objects (and arrays that are not schema nodes) pass through as-is.
 */
export function sanitizeGeminiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeGeminiJsonSchema(entry));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(input)) {
    if (UNSUPPORTED_KEYS.has(key)) {
      continue;
    }

    if ((NESTED_OBJECT_KEYS as readonly string[]).includes(key)) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        const nested: Record<string, unknown> = {};
        for (const [propKey, propSchema] of Object.entries(
          child as Record<string, unknown>,
        )) {
          nested[propKey] = sanitizeGeminiJsonSchema(propSchema);
        }
        output[key] = nested;
      }
      continue;
    }

    if ((NESTED_SCHEMA_ARRAY_KEYS as readonly string[]).includes(key)) {
      if (Array.isArray(child)) {
        output[key] = child.map((entry) => sanitizeGeminiJsonSchema(entry));
      }
      continue;
    }

    if ((NESTED_SCHEMA_KEYS as readonly string[]).includes(key)) {
      // `items` may be a single schema or a tuple array in JSON Schema.
      if (Array.isArray(child)) {
        output[key] = child.map((entry) => sanitizeGeminiJsonSchema(entry));
      } else {
        output[key] = sanitizeGeminiJsonSchema(child);
      }
      continue;
    }

    output[key] = child;
  }

  return output;
}
