import type { z } from 'zod';

/** Stable reason codes for rejected wire input. */
export type WireRejectReason =
  | 'expected_object'
  | 'unknown_type'
  | 'invalid_shape';

export interface WireIssue {
  path: string;
  message: string;
}

export type WireParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WireRejectReason; issues: WireIssue[] };

function describeIssues(error: z.ZodError): WireIssue[] {
  return error.issues.slice(0, 8).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Parse untrusted input against a schema. Never throws; returns a stable
 * reason code plus a bounded issue list on failure.
 *
 * When `discriminator` is given, unknown discriminator values are reported as
 * `unknown_type` instead of a generic shape error.
 */
export function parseWire<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  discriminator?: { key: string; known: ReadonlySet<string> },
): WireParseResult<z.infer<S>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'expected_object', issues: [] };
  }
  if (discriminator) {
    const value = (input as Record<string, unknown>)[discriminator.key];
    if (typeof value !== 'string' || !discriminator.known.has(value)) {
      return {
        ok: false,
        reason: 'unknown_type',
        issues: [
          {
            path: discriminator.key,
            message: `unknown ${discriminator.key}: ${String(value)}`,
          },
        ],
      };
    }
  }
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    reason: 'invalid_shape',
    issues: describeIssues(parsed.error),
  };
}
