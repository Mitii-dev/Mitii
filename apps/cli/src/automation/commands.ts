import {
  AutomationService,
  resolveAutomationDbPath,
  type AutomationSpecRecord,
} from '@mitii/automation';
import {
  createAutomationRunExecutor,
  createCompositeDeliverySender,
} from '@mitii/host';
import Database from 'better-sqlite3';

import type { SessionIo } from '../session.js';
import {
  parseEventIngestFlags,
  parseScheduleFlags,
  peelJsonFlag,
  takeFlagValue,
} from './flags.js';

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
            openDatabase: ((
              filename: string,
              openOptions?: { readonly?: boolean; fileMustExist?: boolean },
            ) => new Database(filename, openOptions)) as never,
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
 io.writeStdout(`mitii schedule — automation schedules

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
    --github-webhook-secret <s>  X-Hub-Signature-256 secret (or env)

  Env:
    MITII_AUTOMATION_DB           SQLite path (default ~/.mitii/automation/automation.db)
    MITII_GITHUB_WEBHOOK_SECRET   GitHub webhook HMAC secret
`);
    return 0;
  }

  const pollMs = takeFlagValue(args, '--poll-ms');
  const dbOverride = takeFlagValue(args, '--db');
  const webhookPort = takeFlagValue(args, '--webhook-port');
  const webhookToken = takeFlagValue(args, '--webhook-token');
  const githubWebhookSecret =
    takeFlagValue(args, '--github-webhook-secret') ??
    process.env.MITII_GITHUB_WEBHOOK_SECRET;
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
      githubWebhookSecret,
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
 io.writeStdout(`mitii events — automation event ingress

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
