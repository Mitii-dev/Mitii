#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execFile, execFileSync } from 'child_process';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { AuditPackBuilder, verifyAuditPack } from '../core/audit';
import { generateHeadlessChangelog, prepareHeadlessRelease } from '../core/headless';
import type { HeadlessRuntime } from '../core/headless/HeadlessConfig';
import type { ProviderType } from '../core/config/schema';
import { createClient, query, DaemonClient, DaemonSessionClient } from '../../packages/sdk/src';
import type { MitiiMode, MitiiEvent } from '../../packages/sdk/src';
import { connectAgentMemoryMcp } from '../core/mcp/mcpWorkspaceConfig';
import { AutoMemoryFileWriter } from '../core/memory/AutoMemoryFileWriter';
import { serveCommand } from '../../packages/daemon/src/cli';
import { startMitiiBoard } from '../../packages/board/src/server';
import { TaskBoardService, ParallelAgentRunner } from '../core/task';
import { WorktreeService } from '../core/git';
import { IndexWorkerService } from '../core/indexing/IndexWorkerService';
import { GitHubPullRequestService, inferGitHubRepo } from '../core/integrations/github';
import { JobQueueService, type MitiiJob } from '../core/jobs';
import { TeamService } from '../core/teams';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const cwd = resolve(valueOf(args, '--cwd') ?? process.cwd());
  const since = valueOf(args, '--since');
  const json = args.includes('--json');
  const prompt = positional(args).join(' ').trim();

  if (!command) {
    if (process.stdin.isTTY) return interactive(cwd, args);
    printHelp();
    return 0;
  }

  if (command === '-i' || command === '--interactive') {
    return interactive(cwd, args, prompt || valueOf(args, '-i') || valueOf(args, '--interactive'));
  }

  if (command === '--help' || command === 'help') {
    printHelp();
    return 0;
  }

  if (command === 'changelog') {
    const changelog = await generateHeadlessChangelog(cwd, since);
    process.stdout.write(json ? JSON.stringify({ changelog }, null, 2) + '\n' : changelog);
    return 0;
  }

  if (command === 'serve') {
    return serveCommand(args, cwd);
  }

  if (command === 'board') {
    return boardCommand(cwd, args);
  }

  if (command === 'task') {
    return taskCommand(cwd, args, json);
  }

  if (command === 'index') {
    return indexCommand(cwd, args, json);
  }

  if (command === 'pr') {
    return prCommand(cwd, args, json);
  }

  if (command === 'job') {
    return jobCommand(cwd, args, json);
  }

  if (command === 'worker') {
    return workerCommand(cwd, args, json);
  }

  if (command === 'team') {
    return teamCommand(cwd, args, json);
  }

  if (command === 'connect') {
    return connectCommand(cwd, args);
  }

  if (command === 'agents' && args[0] === 'init') {
    return initAgentTemplate(cwd, json);
  }

  if (command === 'prepare-release') {
    const result = await prepareHeadlessRelease(cwd, since);
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : result.releaseNotes);
    return 0;
  }

  if (command === 'export-audit') {
    const session = valueOf(args, '--session');
    const output = valueOf(args, '--output') ?? join(cwd, `.mitii/audit/mitii-audit-${Date.now()}.zip`);
    const logPath = session && existsSync(session) ? session : latestSessionLog(cwd);
    const pack = new AuditPackBuilder().build({
      sessionId: session ?? 'headless',
      workspace: cwd,
      extensionVersion: readPackageVersion(cwd),
      logPath,
      summaryMarkdown: logPath ? `# Mitii audit export\n\nLog: ${logPath}\n` : '# Mitii audit export\n\nNo session log found.\n',
    });
    writeFileSync(output, pack.buffer);
    process.stdout.write(json ? JSON.stringify({ output, entries: pack.entries }, null, 2) + '\n' : `${output}\n`);
    return 0;
  }

  if (command === 'verify-audit') {
    const target = positional(args)[0];
    if (!target) {
      process.stderr.write('verify-audit requires a zip path.\n');
      return 2;
    }
    const result = verifyAuditPack(readFileSync(resolve(cwd, target)), process.env.MITII_AUDIT_SIGNING_KEY);
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : formatAuditVerification(result));
    return result.ok ? 0 : 1;
  }

  if (command === 'ask') {
    return runOneShot('ask', cwd, args, prompt || readStdin(), json);
  }

  if (command === 'plan') {
    return runOneShot('plan', cwd, args, prompt || readStdin(), json);
  }

  if (command === 'agent') {
    return runOneShot((valueOf(args, '--mode') as MitiiMode | undefined) ?? 'agent', cwd, args, prompt || readStdin(), json);
  }

  if (command === 'init') {
    return initProjectInstructions(cwd, args, json);
  }

  if (command === 'auth') {
    return authCommand(args, json);
  }

  if (command === 'memory') {
    return memoryCommand(cwd, args, json);
  }

  if (command === 'commit-msg') {
    process.stderr.write(`${command} requires git diff context from the VS Code extension runtime. Use changelog, prepare-release, export-audit, verify-audit, ask, plan, or agent headlessly.\n`);
    return 2;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  return 1;
}

async function runOneShot(mode: MitiiMode, cwd: string, args: string[], prompt: string, json: boolean): Promise<number> {
  const daemonUrl = valueOf(args, '--daemon-url');
  if (daemonUrl) {
    return runDaemonOneShot(mode, cwd, args, prompt, json, daemonUrl);
  }
  const clientOptions = clientOptionsFromArgs(cwd, args);
  if (mode === 'ask' && !json) {
    const client = createClient(clientOptions);
    try {
      process.stdout.write(`${await client.ask(prompt)}\n`);
      return 0;
    } finally {
      await client.dispose();
    }
  }
  if (mode === 'plan' && !json) {
    const client = createClient(clientOptions);
    try {
      process.stdout.write(`${JSON.stringify(await client.plan(prompt), null, 2)}\n`);
      return 0;
    } finally {
      await client.dispose();
    }
  }

  for await (const event of query({ ...clientOptions, mode, prompt, sessionId: valueOf(args, '--session-id') })) {
    if (json) {
      process.stdout.write(JSON.stringify(event) + '\n');
    } else {
      renderCliEvent(event);
    }
  }
  return 0;
}

async function runDaemonOneShot(mode: MitiiMode, cwd: string, args: string[], prompt: string, json: boolean, daemonUrl: string): Promise<number> {
  const client = new DaemonClient({ baseUrl: daemonUrl, token: valueOf(args, '--daemon-token') ?? process.env.MITII_SERVER_TOKEN });
  const session = await DaemonSessionClient.createOrAttach(client, {
    cwd,
    mode,
    approval: (valueOf(args, '--approval') as 'auto' | 'manual' | undefined) ?? 'manual',
  });
  const events = session.events();
  await session.prompt({ mode, message: prompt });
  for await (const event of events) {
    if (json) {
      process.stdout.write(JSON.stringify(event) + '\n');
    } else {
      renderCliEvent(event);
    }
    if (event.type === 'done' || event.type === 'error') break;
  }
  return 0;
}

function clientOptionsFromArgs(cwd: string, args: string[]) {
  const saved = loadDefaultCredentials();
  const provider = (valueOf(args, '--provider') as ProviderType | undefined) ?? saved.provider ?? 'echo';
  const runtime = (valueOf(args, '--runtime') as HeadlessRuntime | undefined)
    ?? (provider === 'echo' ? 'stub' : 'real');
  return {
    cwd,
    runtime,
    provider,
    baseUrl: valueOf(args, '--base-url') ?? saved.baseUrl,
    model: valueOf(args, '--model') ?? saved.model,
    apiKey: valueOf(args, '--api-key') ?? saved.apiKey,
    approval: (valueOf(args, '--approval') as 'auto' | 'manual' | undefined) ?? 'auto',
    enablePuppeteer: args.includes('--enable-puppeteer'),
    allowNetwork: args.includes('--allow-network'),
    vectors: args.includes('--vectors'),
  };
}

function renderCliEvent(event: MitiiEvent): void {
  if (event.type === 'assistant_delta') process.stdout.write(event.content);
  if (event.type === 'reasoning_delta') process.stderr.write(event.content);
  if (event.type === 'tool_start') process.stderr.write(`\n[tool] ${event.tool}\n`);
  if (event.type === 'approval_required') process.stderr.write(`\n[approval required] ${event.tool}: ${event.message ?? event.id}\n`);
  if (event.type === 'error') process.stderr.write(`\n[error] ${event.message}\n`);
  if (event.type === 'done') process.stdout.write(event.content.endsWith('\n') ? '' : '\n');
}

async function interactive(cwd: string, args: string[], initialPrompt = ''): Promise<number> {
  const rl = createInterface({ input, output });
  let mode: MitiiMode = (valueOf(args, '--mode') as MitiiMode | undefined) ?? 'agent';
  process.stdout.write(`Mitii interactive (${mode}) | ${cwd}\n`);
  process.stdout.write('Slash commands: /ask /plan /agent /review /exit\n\n');
  try {
    let nextPrompt = initialPrompt;
    while (true) {
      const line = nextPrompt || await rl.question(`${mode}> `);
      nextPrompt = '';
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === '/exit' || trimmed === '/quit') break;
      if (['/ask', '/plan', '/agent', '/review'].includes(trimmed)) {
        mode = trimmed.slice(1) as MitiiMode;
        continue;
      }
      await runOneShot(mode, cwd, args, trimmed, false);
    }
    return 0;
  } finally {
    rl.close();
  }
}

async function initProjectInstructions(cwd: string, args: string[], json: boolean): Promise<number> {
  const local = args.includes('--local');
  const force = args.includes('--force');
  const target = join(cwd, local ? '.mitii/MITTII.local.md' : 'MITII.md');
  if (existsSync(target) && !force) {
    const message = `${target} already exists. Re-run with --force to overwrite.`;
    process.stderr.write(`${message}\n`);
    return 2;
  }
  mkdirSync(dirname(target), { recursive: true });
  const template = buildInstructionsTemplate(cwd);
  writeFileSync(target, template, 'utf-8');
  process.stdout.write(json ? JSON.stringify({ path: target }) + '\n' : `Created ${target}\n`);
  return 0;
}

function buildInstructionsTemplate(cwd: string): string {
  const pkgPath = join(cwd, 'package.json');
  let scripts: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      scripts = JSON.parse(readFileSync(pkgPath, 'utf-8')).scripts ?? {};
    } catch {
      scripts = {};
    }
  }
  const scriptLines = Object.entries(scripts)
    .filter(([name]) => /^(build|test|lint|typecheck|compile|smoke)/.test(name))
    .map(([name, command]) => `- ${name}: \`${command}\``);
  return [
    '# MITTII.md',
    '',
    '## Project Commands',
    scriptLines.length ? scriptLines.join('\n') : '- Add build, test, and lint commands here.',
    '',
    '## Architecture Notes',
    '- Describe key packages, runtime boundaries, and important data flows.',
    '',
    '## Conventions',
    '- Keep changes scoped and run the most relevant verification before finishing.',
    '',
    '## Safety',
    '- Do not commit secrets. Prefer local-first tooling unless the task explicitly needs network access.',
    '',
  ].join('\n');
}

async function authCommand(args: string[], json: boolean): Promise<number> {
  const sub = args[0];
  if (sub === 'list' || sub === 'show') {
    const saved = loadDefaultCredentials();
    const shown = { ...saved, apiKey: saved.apiKey ? maskSecret(saved.apiKey) : undefined };
    process.stdout.write(JSON.stringify(shown, null, 2) + '\n');
    return 0;
  }
  const provider = valueOf(args, '--provider');
  const apiKey = valueOf(args, '--apikey') ?? valueOf(args, '--api-key');
  const model = valueOf(args, '--model');
  const baseUrl = valueOf(args, '--base-url');

  if (provider || apiKey || model || baseUrl) {
    saveDefaultCredentials({ provider: provider as ProviderType | undefined, apiKey, model, baseUrl });
    process.stdout.write(json ? JSON.stringify({ saved: true }) + '\n' : 'Saved credentials to ~/.mitii/credentials.json\n');
    return 0;
  }

  const rl = createInterface({ input, output });
  try {
    saveDefaultCredentials({
      provider: (await rl.question('Provider: ')) as ProviderType,
      baseUrl: await rl.question('Base URL: '),
      model: await rl.question('Model: '),
      apiKey: await rl.question('API key: '),
    });
    process.stdout.write('Saved credentials to ~/.mitii/credentials.json\n');
    return 0;
  } finally {
    rl.close();
  }
}

function memoryCommand(cwd: string, args: string[], json: boolean): number {
  const sub = args[0];
  if (sub === 'connect' && args[1] === 'agentmemory') {
    const servers = connectAgentMemoryMcp(cwd);
    process.stdout.write(json ? JSON.stringify({ agentmemory: servers.agentmemory }, null, 2) + '\n' : 'Connected agentmemory MCP in .mitii/mcp.json\n');
    return 0;
  }
  if (sub === 'status') {
    const writer = new AutoMemoryFileWriter(cwd, { scope: 'both' });
    const recent = writer.readRecent(20);
    process.stdout.write(json ? JSON.stringify({ recentCount: recent.length, recent }, null, 2) + '\n' : `Auto-memory files: ${recent.length}\n`);
    return 0;
  }
  if (sub === 'prune') {
    const days = Number(valueOf(args, '--days') ?? 30);
    const removed = new AutoMemoryFileWriter(cwd, { scope: 'both' }).prune(Number.isFinite(days) ? days : 30);
    process.stdout.write(json ? JSON.stringify({ removed }) + '\n' : `Removed ${removed} auto-memory files.\n`);
    return 0;
  }
  process.stderr.write('Usage: mitii memory status|prune|connect agentmemory\n');
  return 2;
}

async function taskCommand(cwd: string, args: string[], json: boolean): Promise<number> {
  const sub = args[0];
  const board = new TaskBoardService(cwd);
  if (sub === 'add') {
    const title = positional(args.slice(1))[0] ?? 'Untitled task';
    const prompt = valueOf(args, '--prompt') ?? title;
    const dependsOn = (valueOf(args, '--depends-on') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    const task = board.add({ title, prompt, dependsOn });
    process.stdout.write(json ? JSON.stringify(task, null, 2) + '\n' : `Added ${task.id}: ${task.title}\n`);
    return 0;
  }
  if (sub === 'list' || !sub) {
    const tasks = board.list();
    process.stdout.write(json ? JSON.stringify({ tasks }, null, 2) + '\n' : formatTasks(tasks));
    return 0;
  }
  if (sub === 'start') {
    const id = args[1];
    if (!id) {
      process.stderr.write('mitii task start requires a task id.\n');
      return 2;
    }
    const task = board.transition(id, 'running');
    process.stdout.write(json ? JSON.stringify(task, null, 2) + '\n' : `Started ${task.id}\n`);
    return 0;
  }
  if (sub === 'run') {
    const runner = new ParallelAgentRunner({
      workspace: cwd,
      parallel: Number(valueOf(args, '--parallel') ?? 2),
      ...clientOptionsFromArgs(cwd, args),
    });
    const result = await runner.runRunnable();
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : `Started ${result.started.length}, completed ${result.completed.length}, failed ${result.failed.length}\n`);
    return result.failed.length ? 1 : 0;
  }
  if (sub === 'worktrees') {
    const worktrees = new WorktreeService(cwd).list();
    process.stdout.write(json ? JSON.stringify({ worktrees }, null, 2) + '\n' : worktrees.map((w) => `${w.taskId}\t${w.status}\t${w.branch}\t${w.path}`).join('\n') + '\n');
    return 0;
  }
  if (sub === 'merge') {
    const id = args[1];
    if (!id) {
      process.stderr.write('mitii task merge requires a task id.\n');
      return 2;
    }
    const result = await mergeTask(cwd, id, {
      squash: args.includes('--squash'),
      cleanup: args.includes('--merge-and-cleanup'),
      forceCleanup: args.includes('--force'),
    });
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : `${result.message}\n`);
    return 0;
  }
  process.stderr.write('Usage: mitii task add|list|start|run|worktrees|merge\n');
  return 2;
}

async function indexCommand(cwd: string, args: string[], json: boolean): Promise<number> {
  const sub = args[0] ?? 'status';
  const worker = new IndexWorkerService({ workspace: cwd });
  await worker.initialize();
  try {
    if (sub === 'status') {
      const status = worker.status();
      process.stdout.write(json ? JSON.stringify(status, null, 2) + '\n' : formatIndexStatus(status));
      return 0;
    }
    if (sub === 'repair') {
      const repair = worker.repair();
      process.stdout.write(json ? JSON.stringify(repair, null, 2) + '\n' : `Removed ${repair.removedFiles} missing files, rebuilt ${repair.rebuiltFtsChunks} FTS chunks, vacuumed: ${repair.vacuumed}\n`);
      return repair.health.ok ? 0 : 1;
    }
    if (sub === 'enqueue' || sub === 'watch') {
      const paths = positional(args.slice(1));
      const result = await worker.enqueue(paths.length ? paths : undefined);
      process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : `Queued ${result.queued} files (${result.added} added, ${result.changed} changed, ${result.deleted} deleted).\n`);
      if (sub === 'watch') {
        process.stderr.write('Initial enqueue complete. Keep `mitii serve` running for continuous index worker API access.\n');
      }
      return 0;
    }
    process.stderr.write('Usage: mitii index status|repair|enqueue|watch [paths...] [--cwd <path>] [--json]\n');
    return 2;
  } finally {
    worker.dispose();
  }
}

async function prCommand(cwd: string, args: string[], json: boolean): Promise<number> {
  const sub = args[0];
  if (sub !== 'create') {
    process.stderr.write('Usage: mitii pr create --title "..." [--body "..."] [--body-file file] [--head branch] [--base main] [--draft false] [--repo owner/name]\n');
    return 2;
  }
  const repoArg = valueOf(args, '--repo');
  const inferred = repoArg
    ? parseOwnerRepo(repoArg)
    : inferGitHubRepo(cwd);
  if (!inferred) {
    process.stderr.write('Could not infer GitHub repo. Pass --repo owner/name.\n');
    return 2;
  }
  const title = valueOf(args, '--title');
  if (!title) {
    process.stderr.write('mitii pr create requires --title.\n');
    return 2;
  }
  const body = valueOf(args, '--body')
    ?? readBodyFile(cwd, valueOf(args, '--body-file'))
    ?? 'Created by Mitii.';
  const head = valueOf(args, '--head') ?? currentGitBranch(cwd);
  const base = valueOf(args, '--base') ?? 'main';
  const token = valueOf(args, '--token') ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!head) {
    process.stderr.write('Could not infer current git branch. Pass --head.\n');
    return 2;
  }
  const result = await new GitHubPullRequestService().createPullRequest({
    ...inferred,
    head,
    base,
    title,
    body,
    draft: valueOf(args, '--draft') !== 'false',
  }, token ?? '');
  process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : `${result.htmlUrl}\n`);
  return 0;
}

async function jobCommand(cwd: string, args: string[], json: boolean): Promise<number> {
  const sub = args[0] ?? 'list';
  const queue = new JobQueueService(cwd);
  if (sub === 'enqueue') {
    const prompt = positional(args.slice(1)).join(' ') || valueOf(args, '--prompt');
    if (!prompt) {
      process.stderr.write('mitii job enqueue requires a prompt.\n');
      return 2;
    }
    const job = queue.enqueue({
      prompt,
      cwd,
      mode: (valueOf(args, '--mode') as MitiiJob['mode'] | undefined) ?? 'agent',
    });
    process.stdout.write(json ? JSON.stringify(job, null, 2) + '\n' : `Enqueued ${job.id}\n`);
    return 0;
  }
  if (sub === 'list' || sub === 'status') {
    const jobs = queue.list();
    process.stdout.write(json ? JSON.stringify({ jobs }, null, 2) + '\n' : formatJobs(jobs));
    return 0;
  }
  process.stderr.write('Usage: mitii job enqueue "prompt" [--mode ask|plan|agent|review] | mitii job list\n');
  return 2;
}

async function workerCommand(cwd: string, args: string[], json: boolean): Promise<number> {
  const once = args.includes('--once');
  const intervalMs = Number(valueOf(args, '--interval-ms') ?? 5000);
  const queue = new JobQueueService(cwd);
  const workerId = `worker-${process.pid}`;
  do {
    const job = queue.lease(workerId);
    if (job) {
      try {
        const output = await runQueuedJob(job, args, json);
        queue.complete(job.id, output);
        process.stderr.write(`Completed job ${job.id}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        queue.fail(job.id, message);
        process.stderr.write(`Failed job ${job.id}: ${message}\n`);
      }
    } else if (once) {
      process.stderr.write('No queued jobs.\n');
    }
    if (once) break;
    await sleep(Number.isFinite(intervalMs) ? intervalMs : 5000);
  } while (true);
  return 0;
}

async function teamCommand(cwd: string, args: string[], json: boolean): Promise<number> {
  const sub = args[0];
  const name = valueOf(args, '--team-name') ?? args[1];
  const teams = new TeamService();
  if (sub === 'create') {
    if (!name) {
      process.stderr.write('mitii team create requires a name.\n');
      return 2;
    }
    const manifest = teams.create(name, { workspace: cwd });
    process.stdout.write(json ? JSON.stringify(manifest, null, 2) + '\n' : `Created team ${manifest.name}\n`);
    return 0;
  }
  if (sub === 'status') {
    if (!name) {
      process.stderr.write('mitii team status requires a name.\n');
      return 2;
    }
    const status = teams.status(name);
    if (!status) {
      process.stderr.write(`Team not found: ${name}\n`);
      return 1;
    }
    process.stdout.write(json ? JSON.stringify(status, null, 2) + '\n' : formatTeamStatus(status));
    return 0;
  }
  if (sub === 'task') {
    const teamName = valueOf(args, '--team-name');
    const title = positional(args.slice(1))[0];
    if (!teamName || !title) {
      process.stderr.write('Usage: mitii team task "title" --team-name <name> [--prompt "..."] [--role implementer]\n');
      return 2;
    }
    const task = teams.addTask(teamName, {
      title,
      prompt: valueOf(args, '--prompt') ?? title,
      assigneeRole: valueOf(args, '--role'),
    });
    process.stdout.write(json ? JSON.stringify(task, null, 2) + '\n' : `Added team task ${task.id}\n`);
    return 0;
  }
  if (sub === 'send') {
    const teamName = valueOf(args, '--team-name');
    const text = positional(args.slice(1)).join(' ');
    if (!teamName || !text) {
      process.stderr.write('Usage: mitii team send "message" --team-name <name> [--from lead] [--to implementer]\n');
      return 2;
    }
    const message = teams.sendMessage(teamName, {
      from: valueOf(args, '--from') ?? 'lead',
      to: valueOf(args, '--to') ?? 'team',
      text,
    });
    process.stdout.write(json ? JSON.stringify(message, null, 2) + '\n' : `Sent message ${message.id}\n`);
    return 0;
  }
  process.stderr.write('Usage: mitii team create <name> | status <name> | task "title" --team-name <name> | send "message" --team-name <name>\n');
  return 2;
}

async function connectCommand(cwd: string, args: string[]): Promise<number> {
  const connector = args[0];
  if (connector === 'telegram') {
    const token = valueOf(args, '--token') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      process.stderr.write('mitii connect telegram requires --token or TELEGRAM_BOT_TOKEN.\n');
      return 2;
    }
    const { TelegramConnector } = await import('../../packages/channels/src/telegram');
    process.stderr.write('Mitii Telegram connector polling. Press Ctrl+C to stop.\n');
    await new TelegramConnector({
      token,
      daemonUrl: valueOf(args, '--daemon-url') ?? 'http://127.0.0.1:4310',
      daemonToken: valueOf(args, '--daemon-token') ?? process.env.MITII_SERVER_TOKEN,
      cwd,
    }).start();
    return 0;
  }
  process.stderr.write('Usage: mitii connect telegram --token <bot-token> [--daemon-url http://127.0.0.1:4310]\n');
  return 2;
}

async function runQueuedJob(job: MitiiJob, args: string[], json: boolean): Promise<string> {
  let output = '';
  for await (const event of query({
    ...clientOptionsFromArgs(job.cwd, args),
    cwd: job.cwd,
    mode: job.mode,
    prompt: job.prompt,
    sessionId: job.id,
  })) {
    if (json) process.stdout.write(JSON.stringify(event) + '\n');
    if (event.type === 'assistant_delta') output += event.content;
    if (event.type === 'done') break;
    if (event.type === 'error') throw new Error(event.message);
  }
  return output.trim() || 'Completed without assistant output.';
}

async function mergeTask(cwd: string, id: string, options: { squash: boolean; cleanup: boolean; forceCleanup: boolean }): Promise<{ id: string; branch: string; message: string }> {
  const board = new TaskBoardService(cwd);
  const task = board.list().find((item) => item.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.status !== 'review' && task.status !== 'done') {
    throw new Error(`Task ${id} must be in review or done status before merge`);
  }
  const worktrees = new WorktreeService(cwd);
  const entry = worktrees.list().find((item) => item.taskId === id);
  const branch = task.branch ?? entry?.branch;
  if (!branch) throw new Error(`Task ${id} has no worktree branch`);
  await execFileAsync('git', ['merge', '--no-commit', '--no-ff', branch], { cwd });
  if (options.squash) {
    await execFileAsync('git', ['merge', '--abort'], { cwd }).catch(() => undefined);
    await execFileAsync('git', ['merge', '--squash', branch], { cwd });
  }
  board.update(id, { status: 'done' });
  if (options.cleanup) {
    await worktrees.remove(id, { force: options.forceCleanup });
  }
  return { id, branch, message: `Merged ${branch}. Review and commit the staged merge result.` };
}

async function boardCommand(cwd: string, args: string[]): Promise<number> {
  const hostname = valueOf(args, '--hostname') ?? '127.0.0.1';
  const port = Number(valueOf(args, '--port') ?? 4311);
  const board = await startMitiiBoard({ cwd, hostname, port: Number.isFinite(port) ? port : 4311, token: valueOf(args, '--token') });
  process.stderr.write(`Mitii board listening on ${board.url}\n`);
  const shutdown = async () => {
    await board.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await new Promise(() => undefined);
  return 0;
}

function initAgentTemplate(cwd: string, json: boolean): number {
  const target = join(cwd, '.mitii', 'agents', 'security-reviewer.md');
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(target)) {
    writeFileSync(target, [
      '---',
      'id: security-reviewer',
      'type: reviewer',
      'tools: [read_file, read_files, search, search_batch, git_diff, diagnostics, run_command]',
      'maxSteps: 10',
      '---',
      '',
      'You are a security-focused reviewer. Check for injection, auth bypass, secret leaks, unsafe file access, and missing validation.',
      '',
    ].join('\n'), 'utf-8');
  }
  process.stdout.write(json ? JSON.stringify({ path: target }) + '\n' : `Created ${target}\n`);
  return 0;
}

function formatTasks(tasks: import('../core/task').MitiiTask[]): string {
  if (tasks.length === 0) return 'No tasks.\n';
  return tasks.map((task) => `${task.id}\t${task.status}\t${task.title}`).join('\n') + '\n';
}

function formatIndexStatus(status: import('../core/indexing/IndexMaintenanceService').IndexStatusReport): string {
  return [
    `Workspace: ${status.workspace}`,
    `Files: ${status.filesIndexed}/${status.filesTotal} indexed`,
    `Chunks: ${status.chunks}`,
    `Symbols: ${status.symbols}`,
    `Queue: ${status.queued} queued, running: ${status.running}, failed: ${status.failed}`,
    `Database: ${status.dbPath ?? 'unknown'}${status.dbSizeBytes !== undefined ? ` (${status.dbSizeBytes} bytes)` : ''}`,
    `Health: ${status.health.ok ? 'ok' : `issues (${status.health.errors.join('; ') || status.health.missingTables.join(', ')})`}`,
    '',
  ].join('\n');
}

function formatJobs(jobs: MitiiJob[]): string {
  if (jobs.length === 0) return 'No jobs.\n';
  return jobs.map((job) => `${job.id}\t${job.status}\t${job.mode}\t${job.prompt.slice(0, 80)}`).join('\n') + '\n';
}

function formatTeamStatus(status: NonNullable<ReturnType<TeamService['status']>>): string {
  return [
    `${status.manifest.name} (${status.manifest.id})`,
    `Roles: ${status.manifest.roles.join(', ')}`,
    `Tasks: ${status.tasks.length}`,
    `Unread messages: ${status.messages.filter((message) => !message.read).length}`,
    '',
  ].join('\n');
}

function parseOwnerRepo(value: string): { owner: string; repo: string } | undefined {
  const [owner, repo] = value.split('/');
  return owner && repo ? { owner, repo } : undefined;
}

function readBodyFile(cwd: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return readFileSync(resolve(cwd, path), 'utf8');
}

function currentGitBranch(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function valueOf(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!['--json', '--enable-puppeteer', '--allow-network', '--vectors', '--force', '--local'].includes(arg)) index += 1;
      continue;
    }
    if (arg === '-i') {
      index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8').trim();
  } catch {
    return '';
  }
}

function latestSessionLog(cwd: string): string | undefined {
  const dir = join(cwd, '.mitii', 'logs');
  if (!existsSync(dir)) return undefined;
  const fs = require('fs') as typeof import('fs');
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
  const last = files[files.length - 1];
  return last ? join(dir, last) : undefined;
}

function readPackageVersion(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(): void {
  process.stdout.write([
    'Mitii CLI',
    '',
    'Commands:',
    '  mitii [--mode ask|plan|agent|review]      Start interactive terminal session',
    '  mitii -i "prompt"                         Start interactive session with an initial prompt',
    '  mitii init [--local] [--force] [--cwd <path>] [--json]',
    '  mitii auth [--provider <id> --base-url <url> --model <id> --apikey <key>]',
    '  mitii serve [--hostname 127.0.0.1] [--port 4310] [--token <token>] [--max-sessions 5]',
    '  mitii board [--hostname 127.0.0.1] [--port 4311]',
    '  mitii agents init [--cwd <path>] [--json]',
    '  mitii task add "title" --prompt "..." [--depends-on <id,id>] [--json]',
    '  mitii task list|start <id>|run [--parallel 2]|worktrees [--cwd <path>] [--json]',
    '  mitii index status|repair|enqueue|watch [paths...] [--cwd <path>] [--json]',
    '  mitii pr create --title "..." [--body-file .mitii/pr-body.md] [--repo owner/name] [--head branch] [--base main]',
    '  mitii job enqueue "prompt" [--mode agent] | mitii job list [--json]',
    '  mitii worker [--once] [--interval-ms 5000] [--runtime real|stub] [--provider echo|openai|...]',
    '  mitii team create <name> | status <name> | task "title" --team-name <name> | send "message" --team-name <name>',
    '  mitii connect telegram --token <bot-token> [--daemon-url http://127.0.0.1:4310]',
    '  mitii auth list',
    '  mitii memory status|prune|connect agentmemory [--cwd <path>] [--json]',
    '  mitii changelog [--since <tag>] [--cwd <path>] [--json]',
    '  mitii prepare-release [--since <tag>] [--cwd <path>] [--json]',
    '  mitii export-audit [--session <jsonl-path>] [--output <zip>] [--cwd <path>] [--json]',
    '  mitii verify-audit <zip> [--cwd <path>] [--json]',
    '  mitii ask "question" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--base-url <url>] [--cwd <path>] [--json]',
    '  mitii plan "goal" [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--approval auto|manual] [--cwd <path>]',
    '  mitii agent "goal" [--mode ask|plan|agent|review] [--runtime real|stub] [--provider echo|openai|...] [--model <id>] [--approval auto|manual] [--enable-puppeteer] [--allow-network] [--vectors] [--json]',
    '  Add --daemon-url http://127.0.0.1:4310 to ask/plan/agent to attach to mitii serve.',
    '',
  ].join('\n'));
}

type SavedCredentials = {
  provider?: ProviderType;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

function credentialsPath(): string {
  return join(homedir(), '.mitii', 'credentials.json');
}

function loadDefaultCredentials(): SavedCredentials {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), 'utf-8')) as SavedCredentials;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveDefaultCredentials(next: SavedCredentials): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  const merged = { ...loadDefaultCredentials(), ...compact(next) };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on filesystems that do not support chmod.
  }
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' ? v.trim().length > 0 : v !== undefined)) as Partial<T>;
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function formatAuditVerification(result: ReturnType<typeof verifyAuditPack>): string {
  if (result.ok) {
    return `Audit pack verified (${result.entries.length} entries).\n`;
  }
  return `Audit pack verification failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
