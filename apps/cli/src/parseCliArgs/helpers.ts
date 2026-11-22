export function takeValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; next: number } | { error: string } {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    return { error: `mitii: ${flag} requires a value` };
  }
  return { value, next: index + 1 };
}

/**
 * Peel global host flags that may appear after a passthrough subcommand
 * (`memory`, `mcp`, `history`, …). Those args otherwise land in `rest` and
 * never set `json` / `cwd` / `echo` on the parsed result.
 */
export function peelGlobalPassthroughFlags(args: string[]): {
  rest: string[];
  json: boolean;
  echo: boolean;
  cwd?: string;
  error?: string;
} {
  const rest: string[] = [];
  let json = false;
  let echo = false;
  let cwd: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--echo') {
      echo = true;
      continue;
    }
    if (arg === '--cwd') {
      const taken = takeValue(args, i, '--cwd');
      if ('error' in taken) {
        return { rest: [], json, echo, error: taken.error };
      }
      cwd = taken.value;
      i = taken.next;
      continue;
    }
    rest.push(arg);
  }
  return { rest, json, echo, cwd };
}
