/**
 * Shared helpers for tool-argument normalization (restrict-only aliases).
 */

export const SEARCH_QUERY_ALIASES = ["pattern", "regex", "q", "text", "needle"] as const;
export const COMMAND_ALIASES = ["command", "cmd", "shell"] as const;

export function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return n > 0 ? n : undefined;
  }
  return undefined;
}

export function hasNonEmptyArgv(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Best-effort split of a shell-ish command string into argv.
 * Does not implement a full shell parser — enough for `git status`, `cat file`.
 */
export function toArgv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const parts = value.map(String).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const parts = parsed.map(String).map((s) => s.trim()).filter(Boolean);
        return parts.length > 0 ? parts : undefined;
      }
    } catch {
      // fall through to whitespace split
    }
  }
  return splitShellish(trimmed);
}

function splitShellish(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}
