import { SHELL_METACHARACTERS } from "./constants";
import { DEFAULT_READONLY_COMMAND_PREFIXES } from "./defaults";

/** Characters that make argv→shell reconstruction ambiguous or injectable. */
export function containsShellMetacharacters(value: string): boolean {
  for (const meta of SHELL_METACHARACTERS) {
    if (value.includes(meta)) {
      return true;
    }
  }
  return false;
}

export function argvMatchesPrefix(
  argv: readonly string[],
  prefix: string,
): boolean {
  const expected = tokenizeCommandPrefix(prefix);
  if (expected.length === 0 || argv.length < expected.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (argv[i] !== expected[i]) {
      return false;
    }
  }
  return true;
}

export function tokenizeCommandPrefix(prefix: string): string[] {
  return prefix
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

export function isDefaultReadonlyCommandPrefix(prefix: string): boolean {
  return (DEFAULT_READONLY_COMMAND_PREFIXES as readonly string[]).includes(
    prefix,
  );
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[a-zA-Z0-9]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /token["\s:=]+["']?[a-zA-Z0-9._-]{8,}/gi,
  /password["\s:=]+["']?[^\s"']{4,}/gi,
];

export function redactSecrets(value: string): {
  text: string;
  redacted: boolean;
} {
  let text = value;
  let redacted = false;
  for (const pattern of SECRET_PATTERNS) {
    const next = text.replace(pattern, "[REDACTED]");
    if (next !== text) {
      redacted = true;
      text = next;
    }
  }
  return { text, redacted };
}
