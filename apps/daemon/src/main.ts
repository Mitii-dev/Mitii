/**
 * apps/daemon — long-lived Mitii automation process.
 *
 * Architecture: depends on @mitii/automation (queue) + @mitii/host (SDK executor + delivery).
 * Does not import apps/cli (REPO_LAYOUT forbids app→app).
 * Equivalent to `mitii serve` in the CLI.
 */
import {
  AutomationService,
  resolveAutomationDbPath,
} from '@mitii/automation';
import {
  createAutomationRunExecutor,
  createCompositeDeliverySender,
} from '@mitii/host';

function parseArgs(argv: string[]): {
  cwd: string;
  dbPath?: string;
  forceEcho: boolean;
  pollIntervalMs: number;
  webhookPort?: number;
  webhookToken?: string;
  githubWebhookSecret?: string;
} {
  let cwd = process.cwd();
  let dbPath: string | undefined;
  let forceEcho = false;
  let pollIntervalMs = 5_000;
  let webhookPort: number | undefined;
  let webhookToken: string | undefined;
  let githubWebhookSecret: string | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--cwd') {
      cwd = argv[++i] ?? cwd;
      continue;
    }
    if (arg === '--db') {
      dbPath = argv[++i];
      continue;
    }
    if (arg === '--echo') {
      forceEcho = true;
      continue;
    }
    if (arg === '--poll-ms') {
      pollIntervalMs = Number(argv[++i] ?? 5000);
      continue;
    }
    if (arg === '--webhook-port') {
      webhookPort = Number(argv[++i] ?? 0);
      continue;
    }
    if (arg === '--webhook-token') {
      webhookToken = argv[++i];
      continue;
    }
    if (arg === '--github-webhook-secret') {
      githubWebhookSecret = argv[++i];
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`mitii-daemon — automation serve loop

  --cwd <path>          Workspace for .mitii/cron reconcile (default: cwd)
  --db <path>           Override automation SQLite path
  --poll-ms <n>         Materialize/claim poll interval (default 5000)
  --webhook-port <n>    HTTP event ingress
  --webhook-token <t>   Optional bearer for ingress
  --github-webhook-secret <s>  GitHub HMAC secret (or MITII_GITHUB_WEBHOOK_SECRET)
  --echo                Force echo LLM (smoke)

DB default: ${resolveAutomationDbPath()}
`);
      process.exit(0);
    }
  }
  return {
    cwd,
    dbPath,
    forceEcho,
    pollIntervalMs,
    webhookPort,
    webhookToken,
    githubWebhookSecret:
      githubWebhookSecret ?? process.env.MITII_GITHUB_WEBHOOK_SECRET,
  };
}

const opts = parseArgs(process.argv);
const dbPath = resolveAutomationDbPath({ dbPath: opts.dbPath });
const service = new AutomationService({
  dbPath,
  executor: createAutomationRunExecutor({ forceEcho: opts.forceEcho }),
  deliverySender: createCompositeDeliverySender({}),
  onEvent: (event) => {
    if (event.type === 'run_started') {
      process.stderr.write(
        `[mitii-daemon] start ${event.title} (${event.runId})\n`,
      );
    } else if (event.type === 'run_finished') {
      process.stderr.write(
        `[mitii-daemon] ${event.status} ${event.runId}${event.error ? `: ${event.error}` : ''}\n`,
      );
    } else if (event.type === 'error') {
      process.stderr.write(`[mitii-daemon] error: ${event.message}\n`);
    }
  },
});

process.stderr.write(
  `[mitii-daemon] db=${dbPath} workspace=${opts.cwd}\n`,
);
const reconciled = service.reconcileFiles({ workspaceRoot: opts.cwd });
process.stderr.write(
  `[mitii-daemon] reconcile upserted=${reconciled.upserted.length} removed=${reconciled.removed.length}\n`,
);
service.start({
  workspaceRoot: opts.cwd,
  pollIntervalMs: opts.pollIntervalMs,
  autoReconcile: true,
});
if (opts.webhookPort) {
  const url = await service.startWebhook({
    port: opts.webhookPort,
    token: opts.webhookToken,
    githubWebhookSecret: opts.githubWebhookSecret,
    workspaceRoot: opts.cwd,
  });
  process.stderr.write(`[mitii-daemon] webhook ${url}\n`);
}
process.stderr.write('[mitii-daemon] running (SIGINT/SIGTERM to stop)\n');

await new Promise<void>((resolve) => {
  const stop = () => {
    service.stop();
    service.close();
    resolve();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
});
