export function parseEventIngestFlags(args: string[]): {
  type?: string;
  source?: string;
  id?: string;
  subject?: string;
  dedupeKey?: string;
  jsonFile?: string;
  workspace?: string;
  attributes: Record<string, unknown>;
} {
  const out: ReturnType<typeof parseEventIngestFlags> = { attributes: {} };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--type') {
      out.type = args[++i];
      continue;
    }
    if (arg === '--source') {
      out.source = args[++i];
      continue;
    }
    if (arg === '--id') {
      out.id = args[++i];
      continue;
    }
    if (arg === '--subject') {
      out.subject = args[++i];
      continue;
    }
    if (arg === '--dedupe-key') {
      out.dedupeKey = args[++i];
      continue;
    }
    if (arg === '--json-file') {
      out.jsonFile = args[++i];
      continue;
    }
    if (arg === '--workspace' || arg === '--cwd') {
      out.workspace = args[++i];
      continue;
    }
    if (arg === '--attr') {
      const pair = args[++i] ?? '';
      const eq = pair.indexOf('=');
      if (eq > 0) {
        out.attributes[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      continue;
    }
  }
  return out;
}

export function peelJsonFlag(args: string[]): { args: string[]; json: boolean } {
  let json = false;
  const out: string[] = [];
  for (const arg of args) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    out.push(arg);
  }
  return { args: out, json };
}

export function takeFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

export function parseScheduleFlags(args: string[]): {
  name?: string;
  cron?: string;
  prompt?: string;
  workspace?: string;
  timezone?: string;
  mode?: 'ask' | 'plan' | 'agent';
  autonomy?: 'readonly' | 'propose' | 'apply' | 'apply_and_pr';
  timeout?: number;
  maxParallel?: number;
} {
  const out: ReturnType<typeof parseScheduleFlags> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--cron') {
      out.cron = args[++i];
      continue;
    }
    if (arg === '--prompt') {
      out.prompt = args[++i];
      continue;
    }
    if (arg === '--workspace' || arg === '--cwd') {
      out.workspace = args[++i];
      continue;
    }
    if (arg === '--timezone') {
      out.timezone = args[++i];
      continue;
    }
    if (arg === '--mode') {
      const v = args[++i];
      if (v === 'ask' || v === 'plan' || v === 'agent') out.mode = v;
      continue;
    }
    if (arg === '--autonomy') {
      const v = args[++i];
      if (
        v === 'readonly' ||
        v === 'propose' ||
        v === 'apply' ||
        v === 'apply_and_pr'
      ) {
        out.autonomy = v;
      }
      continue;
    }
    if (arg === '--timeout') {
      out.timeout = Number(args[++i]);
      continue;
    }
    if (arg === '--max-parallel') {
      out.maxParallel = Number(args[++i]);
      continue;
    }
    if (!arg.startsWith('-')) positionals.push(arg);
  }
  out.name = positionals.join(' ').trim() || undefined;
  return out;
}
