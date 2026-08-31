import {
  AutomationService,
  resolveAutomationDbPath,
  type AutomationSpecRecord,
} from '@mitii/automation';
import {
  createAutomationRunExecutor,
  createCompositeDeliverySender,
} from '@mitii/host';

import type { SessionIo } from '../session.js';

export function printSpec(io: SessionIo, spec: AutomationSpecRecord): void {
  io.writeStdout(
    [
      `id=${spec.specId}`,
      `title=${spec.title}`,
      `enabled=${spec.enabled}`,
      `cron=${spec.scheduleExpr ?? '-'}`,
      `next=${spec.nextRunAt ?? '-'}`,
      `workspace=${spec.workspaceRoot ?? '-'}`,
      `mode=${spec.mode ?? '-'}`,
      `autonomy=${spec.autonomyPreset ?? '-'}`,
      `source=${spec.source}`,
    ].join(' ') + '\n',
  );
}

export function openAutomationService(options: {
  dbPath?: string;
  withExecutor?: boolean;
  forceEcho?: boolean;
  onEvent?: (event: import('@mitii/automation').ClaimRunnerEvent) => void;
}): AutomationService {
  const dbPath = resolveAutomationDbPath({ dbPath: options.dbPath });
  return new AutomationService({
    dbPath,
    ...(options.withExecutor
      ? {
          executor: createAutomationRunExecutor({
            forceEcho: options.forceEcho,
          }),
          deliverySender: createCompositeDeliverySender({}),
        }
      : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
}

export async function runScheduleCommand(options: {
  args: string[];
  cwd: string;
  json?: boolean;
  dbPath?: string;
  io: SessionIo;
}): Promise<number> {
  const { cwd, io } = options;
  const peeled = peelJsonFlag(options.args);
  const json = options.json === true || peeled.json;
  const [sub = 'list', ...rest] = peeled.args;

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    io.writeStdout(`mitii schedule — automation schedules (Phase 1)

  create <name> --cron "0 9 * * *" --prompt "…" [--workspace <path>]
  list | get <id> | pause <id> | resume <id> | delete <id>
  trigger <id> | history [id] | stats | upcoming | reconcile
  export [--out file.json] | import --from file.json

File specs: <workspace>/.mitii/cron/*.cron.md
DB: ${resolveAutomationDbPath({ dbPath: options.dbPath })}
`);
    return 0;
  }

  const service = openAutomationService({ dbPath: options.dbPath });

  try {
    switch (sub) {
      case 'create': {
        const flags = parseScheduleFlags(rest);
        if (!flags.name || !flags.cron || !flags.prompt) {
          io.writeStderr(
            'usage: mitii schedule create <name> --cron "…" --prompt "…" [--workspace <path>]\n',
          );
          return 2;
        }
        const spec = service.createSchedule({
          name: flags.name,
          cron: flags.cron,
          prompt: flags.prompt,
          workspaceRoot: flags.workspace ?? cwd,
          timezone: flags.timezone,
          mode: flags.mode,
          autonomyPreset: flags.autonomy,
          timeoutSeconds: flags.timeout,
          maxParallel: flags.maxParallel,
        });
        if (json) {
          io.writeStdout(`${JSON.stringify(spec, null, 2)}\n`);
        } else {
          io.writeStdout(`created ${spec.specId}\n`);
          printSpec(io, spec);
        }
        return 0;
      }
      case 'list': {
        const specs = service.listSchedules();
        if (json) {
          io.writeStdout(`${JSON.stringify(specs, null, 2)}\n`);
        } else if (specs.length === 0) {
          io.writeStdout('No schedules.\n');
        } else {
          for (const spec of specs) printSpec(io, spec);
        }
        return 0;
      }
      case 'get': {
        const id = rest[0];
        if (!id) {
          io.writeStderr('usage: mitii schedule get <id>\n');
          return 2;
        }
        const spec = service.getSchedule(id);
        if (!spec) {
          io.writeStderr(`unknown schedule: ${id}\n`);
          return 1;
        }
        if (json) io.writeStdout(`${JSON.stringify(spec, null, 2)}\n`);
        else printSpec(io, spec);
        return 0;
      }
      case 'pause':
      case 'resume':
      case 'delete':
      case 'trigger': {
        const id = rest[0];
        if (!id) {
          io.writeStderr(`usage: mitii schedule ${sub} <id>\n`);
          return 2;
        }
        if (sub === 'pause') service.pause(id);
        else if (sub === 'resume') service.resume(id);
        else if (sub === 'delete') service.delete(id);
        else {
          const run = service.trigger(id);
          if (json) io.writeStdout(`${JSON.stringify(run, null, 2)}\n`);
          else io.writeStdout(`queued ${run.runId} for ${id}\n`);
          return 0;
        }
        io.writeStdout(`${sub} ${id}\n`);
        return 0;
      }
      case 'history':
      case 'executions': {
        const id = rest[0];
        const runs = service.listRuns({
          ...(id ? { specId: id } : {}),
          limit: 50,
        });
        if (json) io.writeStdout(`${JSON.stringify(runs, null, 2)}\n`);
        else {
          for (const run of runs) {
            io.writeStdout(
              `${run.runId} spec=${run.specId} status=${run.status} at=${run.createdAt}${run.error ? ` error=${run.error}` : ''}\n`,
            );
          }
        }
        return 0;
      }
      case 'stats': {
        const stats = service.stats();
        if (json) io.writeStdout(`${JSON.stringify(stats, null, 2)}\n`);
        else {
          io.writeStdout(
            `specs=${stats.specs} enabled=${stats.enabled} queued=${stats.queued} running=${stats.running} done=${stats.done} failed=${stats.failed}\n`,
          );
        }
        return 0;
      }
      case 'upcoming': {
        const rows = service.upcoming(20);
        if (json) io.writeStdout(`${JSON.stringify(rows, null, 2)}\n`);
        else {
          for (const row of rows) {
            io.writeStdout(`${row.nextRunAt}  ${row.title}  (${row.specId})\n`);
          }
        }
        return 0;
      }
      case 'reconcile': {
        const result = service.reconcileFiles({ workspaceRoot: cwd });
        if (json) io.writeStdout(`${JSON.stringify(result, null, 2)}\n`);
        else {
          io.writeStdout(
            `upserted=${result.upserted.length} removed=${result.removed.length} invalid=${result.invalid.length}\n`,
          );
          for (const bad of result.invalid) {
            io.writeStderr(`invalid ${bad.path}: ${bad.error}\n`);
          }
        }
        return result.invalid.length > 0 ? 1 : 0;
      }
      case 'export': {
        const outPath = takeFlagValue(rest, '--out') ?? rest[0];
        const payload = service.exportSpecs();
        if (outPath) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
          io.writeStdout(`exported ${payload.specs.length} specs → ${outPath}\n`);
        } else {
          io.writeStdout(`${JSON.stringify(payload, null, 2)}\n`);
        }
        return 0;
      }
      case 'import': {
        const inPath = takeFlagValue(rest, '--from') ?? rest[0];
        if (!inPath) {
          io.writeStderr('usage: mitii schedule import --from <file.json>\n');
          return 2;
        }
        const { readFileSync } = await import('node:fs');
        const payload = JSON.parse(readFileSync(inPath, 'utf8')) as {
          specs: Array<Record<string, unknown>>;
        };
        const result = service.importSpecs(payload);
        io.writeStdout(`imported upserted=${result.upserted}\n`);
        return 0;
      }
      case 'help':
      default: {
        io.writeStdout(`mitii schedule — automation schedules

  create <name> --cron "0 9 * * *" --prompt "…" [--workspace <path>]
  list | get <id> | pause <id> | resume <id> | delete <id>
  trigger <id> | history [id] | stats | upcoming | reconcile
  export [--out file.json] | import --from file.json

File specs: <workspace>/.mitii/cron/*.cron.md
DB: ${resolveAutomationDbPath({ dbPath: options.dbPath })}
`);
        return 2;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`${message}\n`);
    return 1;
  } finally {
    service.close();
  }
}

export async function runServeCommand(options: {
  args?: string[];
  cwd: string;
  dbPath?: string;
  forceEcho?: boolean;
  pollIntervalMs?: number;
  io: SessionIo;
}): Promise<number> {
  const { cwd, io } = options;
  const args = options.args ?? [];
  if (
    args.includes('--help') ||
    args.includes('-h') ||
    args[0] === 'help'
  ) {
    io.writeStdout(`mitii serve — run the automation daemon

  Polls due schedules, reconciles .mitii/cron/**/*.md (including events/),
  and executes claimed runs via the host AutomationRunExecutor
  (origin=automation).

  Options:
    --poll-ms <n>         Poll interval (default 5000)
    --echo                Force echo provider (local smoke)
    --db <path>           Override automation DB path
    --webhook-port <n>    HTTP ingress (POST /events, /hooks/github)
    --webhook-token <t>   Optional bearer / X-Mitii-Token

  Env:
    MITII_AUTOMATION_DB   SQLite path (default ~/.mitii/automation/automation.db)
`);
    return 0;
  }

  const pollMs = takeFlagValue(args, '--poll-ms');
  const dbOverride = takeFlagValue(args, '--db');
  const webhookPort = takeFlagValue(args, '--webhook-port');
  const webhookToken = takeFlagValue(args, '--webhook-token');
  const forceEcho = options.forceEcho === true || args.includes('--echo');

  const service = openAutomationService({
    dbPath: dbOverride ?? options.dbPath,
    withExecutor: true,
    forceEcho,
    onEvent: (event) => {
      if (event.type === 'run_started') {
        io.writeStderr(
          `[mitii serve] start ${event.title} (${event.runId})\n`,
        );
      } else if (event.type === 'run_finished') {
        io.writeStderr(
          `[mitii serve] ${event.status} ${event.runId}${event.error ? `: ${event.error}` : ''}\n`,
        );
      } else if (event.type === 'error') {
        io.writeStderr(`[mitii serve] error: ${event.message}\n`);
      }
    },
  });

  io.writeStderr(
    `[mitii serve] db=${service.store.dbPath} workspace=${cwd}\n`,
  );
  const reconciled = service.reconcileFiles({ workspaceRoot: cwd });
  io.writeStderr(
    `[mitii serve] reconcile upserted=${reconciled.upserted.length} removed=${reconciled.removed.length}\n`,
  );
  service.start({
    workspaceRoot: cwd,
    pollIntervalMs:
      pollMs !== undefined
        ? Number(pollMs)
        : (options.pollIntervalMs ?? 5_000),
    autoReconcile: true,
  });
  if (webhookPort) {
    const url = await service.startWebhook({
      port: Number(webhookPort),
      token: webhookToken,
      workspaceRoot: cwd,
    });
    io.writeStderr(`[mitii serve] webhook ${url}\n`);
  }
  io.writeStderr('[mitii serve] running (Ctrl-C to stop)\n');

  await new Promise<void>((resolve) => {
    const stop = () => {
      service.stop();
      service.close();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

export async function runEventsCommand(options: {
  args: string[];
  cwd: string;
  json?: boolean;
  dbPath?: string;
  io: SessionIo;
}): Promise<number> {
  const { cwd, io } = options;
  const peeled = peelJsonFlag(options.args);
  const json = options.json === true || peeled.json;
  const [sub = 'list', ...rest] = peeled.args;

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    io.writeStdout(`mitii events — automation event ingress (Phase 2)

  list [--json]
  ingest --type <eventType> --source <source> [--id <id>] [--subject <s>]
         [--dedupe-key <k>] [--json-file <path>] [--attr key=value]
  github-normalize --json-file <path>   # dry-run GitHub payload → envelope

File specs: <workspace>/.mitii/cron/events/*.event.md
`);
    return 0;
  }

  const service = openAutomationService({ dbPath: options.dbPath });
  try {
    switch (sub) {
      case 'list': {
        const events = service.listEvents({ limit: 50 });
        if (json) {
          io.writeStdout(`${JSON.stringify(events, null, 2)}\n`);
        } else if (events.length === 0) {
          io.writeStdout('No events.\n');
        } else {
          for (const event of events) {
            io.writeStdout(
              `${event.receivedAt} ${event.eventType} status=${event.processingStatus} id=${event.eventId} queued=${event.queuedRunCount}\n`,
            );
          }
        }
        return 0;
      }
      case 'ingest': {
        const flags = parseEventIngestFlags(rest);
        if (!flags.type || !flags.source) {
          io.writeStderr(
            'usage: mitii events ingest --type <t> --source <s> [--json-file path]\n',
          );
          return 2;
        }
        let payload: Record<string, unknown> | undefined;
        let attributes = flags.attributes;
        if (flags.jsonFile) {
          const { readFileSync } = await import('node:fs');
          const raw = JSON.parse(readFileSync(flags.jsonFile, 'utf8')) as unknown;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            payload = raw as Record<string, unknown>;
          }
        }
        const { newId } = await import('@mitii/automation');
        const result = service.ingestEvent({
          eventId: flags.id ?? newId('evt'),
          eventType: flags.type,
          source: flags.source,
          subject: flags.subject,
          dedupeKey: flags.dedupeKey,
          workspaceRoot: flags.workspace ?? cwd,
          payload,
          attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
        });
        if (json) {
          io.writeStdout(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          io.writeStdout(
            `event=${result.event.eventId} status=${result.event.processingStatus} queued=${result.queuedRuns.length} duplicate=${result.duplicate}\n`,
          );
        }
        return 0;
      }
      case 'github-normalize': {
        const file = takeFlagValue(rest, '--json-file');
        if (!file) {
          io.writeStderr('usage: mitii events github-normalize --json-file <path>\n');
          return 2;
        }
        const { readFileSync } = await import('node:fs');
        const { normalizeGitHubWebhook } = await import('@mitii/automation');
        const body = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        const envelope = normalizeGitHubWebhook({
          body,
          workspaceRoot: cwd,
        });
        if (!envelope) {
          io.writeStderr('unrecognized github payload\n');
          return 1;
        }
        io.writeStdout(`${JSON.stringify(envelope, null, 2)}\n`);
        return 0;
      }
      default: {
        io.writeStderr(`unknown events subcommand: ${sub}\n`);
        return 2;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.writeStderr(`${message}\n`);
    return 1;
  } finally {
    service.close();
  }
}

function parseEventIngestFlags(args: string[]): {
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

function peelJsonFlag(args: string[]): { args: string[]; json: boolean } {
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

function takeFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function parseScheduleFlags(args: string[]): {
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
