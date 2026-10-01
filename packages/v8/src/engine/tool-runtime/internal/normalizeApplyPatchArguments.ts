/**
 * Models often mis-encode apply_patch:
 * 1) Flat `{ path, oldText, newText }` instead of `{ patches: [...] }`
 * 2) `patches` as a JSON string instead of an array
 * 3) `expectedHash: null` (Zod optional string rejects null)
 * 4) `replaceAll: "true"` / `"false"` instead of a real boolean
 *
 * Normalize those shapes before schema validation so recoverable calls succeed.
 */

function coerceOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") {
      return true;
    }
    if (lowered === "false") {
      return false;
    }
  }
  return undefined;
}

/**
 * Models often put the file path under filePath / file / filename / target
 * instead of `path`. Promote the first non-empty string alias onto `path`.
 */
function coalescePatchPath(entry: Record<string, unknown>): void {
  if (typeof entry.path === "string" && entry.path.trim().length > 0) {
    return;
  }
  for (const key of ["filePath", "file_path", "file", "filename", "target"] as const) {
    const value = entry[key];
    if (typeof value === "string" && value.trim().length > 0) {
      entry.path = value.trim();
      return;
    }
  }
}

function sanitizePatchEntry(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const entry = { ...(value as Record<string, unknown>) };
  coalescePatchPath(entry);
  const hash = entry.expectedHash;
  if (typeof hash !== "string" || hash.length === 0) {
    delete entry.expectedHash;
  }
  if (entry.replaceAll !== undefined) {
    const replaceAll = coerceOptionalBoolean(entry.replaceAll);
    if (replaceAll === undefined) {
      delete entry.replaceAll;
    } else {
      entry.replaceAll = replaceAll;
    }
  }
  return entry;
}

export function normalizeApplyPatchArguments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const args = { ...(value as Record<string, unknown>) };

  if (typeof args.patches === "string") {
    const trimmed = args.patches.trim();
    if (trimmed.length > 0) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          args.patches = parsed;
        } else if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          typeof (parsed as { path?: unknown }).path === "string"
        ) {
          args.patches = [parsed];
        }
      } catch {
        // Leave as-is; schema validation will reject with a clear warning.
      }
    }
  }

  if (!("patches" in args) || args.patches === undefined) {
    coalescePatchPath(args);
    if (
      typeof args.path === "string" &&
      args.path.trim().length > 0 &&
      "oldText" in args &&
      "newText" in args
    ) {
      const {
        path,
        oldText,
        newText,
        expectedHash,
        replaceAll,
        filePath: _filePath,
        file_path: _file_path,
        file: _file,
        filename: _filename,
        target: _target,
        ...rest
      } = args;
      const patch: Record<string, unknown> = { path, oldText, newText };
      if (typeof expectedHash === "string" && expectedHash.length > 0) {
        patch.expectedHash = expectedHash;
      }
      const coercedReplaceAll = coerceOptionalBoolean(replaceAll);
      if (coercedReplaceAll !== undefined) {
        patch.replaceAll = coercedReplaceAll;
      }
      return {
        ...rest,
        patches: [patch],
      };
    }
  }

  if (Array.isArray(args.patches)) {
    args.patches = args.patches.map(sanitizePatchEntry);
  }

  return args;
}
