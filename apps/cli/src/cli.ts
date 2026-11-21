import { writeFileSync } from 'node:fs';

import { resolveRunAutoOptions } from './commands/runAuto.js';
import { runIndex, runIndexStatus } from './commands/index.js';
import { runSession } from './commands/session.js';
import { runStatus } from './commands/status.js';
import { CLI_HELP } from './help.js';
import { readPackageVersion } from './packageVersion.js';
import { buildSessionExport } from './runReport.js';
import { createDefaultSessionIo, type SessionIo } from './session.js';
import { runSetup } from './setup.js';
import { runAsk, resolveAskPromptWithRecipe } from './runAskCommand.js';
import { runReviewCommand } from './runReviewCommand.js';

import { parseCliArgs } from './parseCliArgs.js';
export { parseCliArgs, type ParsedCliArgs } from './parseCliArgs.js';

export async function main(
  argv: string[] = process.argv,
  io?: SessionIo,
): Promise<number> {
  // Resolve cwd early so dotenv files under --cwd are loaded before provider ports.
  const earlyCwd = (() => {
    const args = argv.slice(2);
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--cwd' && args[i + 1]) return args[i + 1]!;
    }
    return process.cwd();
  })();
  const { loadCliDotEnv } = await import('./loadDotEnv.js');
  loadCliDotEnv(earlyCwd);

  const parsed = parseCliArgs(argv);
  const sessionIo = io ?? createDefaultSessionIo();
  const cwd = parsed.cwd ?? process.cwd();

  switch (parsed.command) {
    case 'help':
      sessionIo.writeStdout(CLI_HELP);
      return 0;
    case 'version':
      sessionIo.writeStdout(`${readPackageVersion()}\n`);
      return 0;
    case 'ask':
    case 'plan':
    case 'agent':
    case 'run':
    case 'commit-message':
    case 'pr-summary':
    case 'changelog': {
      let resolved;
      try {
        if (parsed.command === 'run') {
          const auto = resolveRunAutoOptions({
            auto: parsed.auto === true,
            autonomyPreset: parsed.autonomyPreset,
          });
          if ('error' in auto) {
            sessionIo.writeStderr(`${auto.error}\n\n`);
            sessionIo.writeStdout(CLI_HELP);
            return 2;
          }
          parsed.autonomyPreset = auto.autonomyPreset;
          parsed.autoApproval = auto.autoApproval;
          parsed.origin = auto.origin;
          if (!parsed.mode) {
            parsed.mode = 'agent';
          }
        }
        resolved = await resolveAskPromptWithRecipe(parsed, cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sessionIo.writeStderr(`${message}\n\n`);
        sessionIo.writeStdout(CLI_HELP);
        return 2;
      }
      const { code } = await runAsk({
        prompt: resolved.prompt,
        cwd,
        json: parsed.json === true,
        streamJson: parsed.streamJson === true,
        forceEcho: parsed.forceEcho === true,
        autoClarify: parsed.autoClarify,
        autoApproval: resolved.autoApproval,
        mode: resolved.mode,
        origin: resolved.origin,
        autonomyPreset: resolved.autonomyPreset,
        profile: resolved.profile ?? parsed.profile,
        requiredSkillIds: resolved.requiredSkillIds,
        attachments: resolved.attachments,
        timeoutSeconds: parsed.timeoutSeconds,
        loopPolicyJson: parsed.loopPolicyJson,
        noLoopPolicy: parsed.noLoopPolicy === true,
        io: sessionIo,
      });
      return code;
    }
    case 'paths': {
      const { runPathsCommand } = await import('./commands/paths.js');
      return runPathsCommand({
        cwd,
        json: parsed.json === true,
        doctor: false,
        io: sessionIo,
      });
    }
    case 'doctor': {
      const { runPathsCommand } = await import('./commands/paths.js');
      return runPathsCommand({
        cwd,
        json: parsed.json === true,
        doctor: true,
        io: sessionIo,
      });
    }
    case 'profile': {
      const { runProfileCommand } = await import('./commands/profile.js');
      return runProfileCommand({
        cwd,
        args: parsed.rest,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'index':
      if (parsed.indexStatus === true) {
        return runIndexStatus({
          cwd,
          json: parsed.json === true,
          io: sessionIo,
        });
      }
      return runIndex({
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    case 'review': {
      const mode =
        parsed.reviewCommit
          ? ('commit' as const)
          : parsed.reviewFrom && parsed.reviewTo
            ? ('range' as const)
            : ('workspace' as const);
      const outcome = await runReviewCommand({
        cwd,
        mode,
        fromRef: parsed.reviewFrom,
        toRef: parsed.reviewTo,
        commit: parsed.reviewCommit,
        preview: parsed.reviewPreview === true,
        format: parsed.reviewFormat,
        output: parsed.reviewOutput,
        effort: parsed.reviewEffort,
        io: sessionIo,
      });
      return outcome.exitCode;
    }
    case 'status':
      return runStatus({
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    case 'export-session': {
      if (!parsed.prompt) {
        sessionIo.writeStderr('mitii export-session: missing prompt\n');
        return 2;
      }
      const { code, outcome } = await runAsk({
        prompt: parsed.prompt,
        cwd,
        json: true,
        forceEcho: parsed.forceEcho === true,
        mode: parsed.mode,
        loopPolicyJson: parsed.loopPolicyJson,
        noLoopPolicy: parsed.noLoopPolicy === true,
        io: sessionIo,
      });
      if (outcome && parsed.exportPath) {
        const payload = buildSessionExport({
          result: outcome.result,
          events: outcome.events,
        });
        writeFileSync(parsed.exportPath, `${JSON.stringify(payload, null, 2)}\n`);
        sessionIo.writeStderr(`[mitii] wrote ${parsed.exportPath}\n`);
      }
      return code;
    }
    case 'session':
      return runSession({
        cwd,
        forceEcho: parsed.forceEcho === true,
        mode: parsed.mode,
        loopPolicyJson: parsed.loopPolicyJson,
        noLoopPolicy: parsed.noLoopPolicy === true,
        io: sessionIo,
      });
    case 'setup':
      return runSetup({
        cwd,
        global: parsed.setupGlobal === true,
        show: parsed.setupShow === true,
        provider: parsed.setupProvider,
        model: parsed.setupModel,
        baseUrl: parsed.setupBaseUrl,
        mode: parsed.mode,
        test: parsed.setupTest === true,
        yes: parsed.setupYes === true,
        io: sessionIo,
      });
    case 'connect': {
      const {
        formatAdapterList,
        runConnectAdapter,
        runStopAllConnectors,
        sessionIoToConnectIo,
      } = await import('./connectors/commands/connect.js');
      const connectIo = sessionIoToConnectIo(sessionIo);
      const rest = [...parsed.rest];
      const stopRequested = rest.includes('--stop');
      const channel = rest.find((arg) => !arg.startsWith('-'));
      const passthrough = channel
        ? rest.filter((arg) => arg !== channel)
        : rest;

      // Merge top-level cwd/mode/echo/approve into channel args when absent.
      const withDefaults = [...passthrough];
      if (parsed.cwd && !withDefaults.includes('--cwd')) {
        withDefaults.push('--cwd', parsed.cwd);
      }
      if (parsed.mode && !withDefaults.includes('--mode')) {
        withDefaults.push('--mode', parsed.mode);
      }
      if (parsed.forceEcho && !withDefaults.includes('--echo')) {
        withDefaults.push('--echo');
      }
      if (
        parsed.autoApproval === 'denied' &&
        !withDefaults.includes('--deny')
      ) {
        withDefaults.push('--deny');
      }
      if (
        parsed.autoApproval === 'approved' &&
        !withDefaults.includes('--approve')
      ) {
        withDefaults.push('--approve');
      }

      if (stopRequested) {
        if (channel) {
          // Channel adapters own stop semantics (e.g. filter by bot username).
          return runConnectAdapter(channel, withDefaults, connectIo);
        }
        return runStopAllConnectors(connectIo);
      }
      if (!channel) {
        sessionIo.writeStdout(`\nAdapters:\n${formatAdapterList()}\n\n`);
        sessionIo.writeStdout(
          "Run 'mitii connect <channel> --help' for channel options.\n",
        );
        return 0;
      }
      return runConnectAdapter(channel, withDefaults, connectIo);
    }
    case 'schedule': {
      const { runScheduleCommand } = await import('./automation/commands.js');
      return runScheduleCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'serve': {
      const { runServeCommand } = await import('./automation/commands.js');
      return runServeCommand({
        args: parsed.rest,
        cwd,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    }
    case 'events': {
      const { runEventsCommand } = await import('./automation/commands.js');
      return runEventsCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'restore': {
      const { runRestoreCommand } = await import('./commands/restore.js');
      return runRestoreCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    }
    case 'recipe': {
      const { runRecipeCommand } = await import('./commands/recipe.js');
      return runRecipeCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        forceEcho: parsed.forceEcho === true,
        io: sessionIo,
      });
    }
    case 'mcp': {
      const { runMcpCommand } = await import('./commands/mcp.js');
      return runMcpCommand({
        cwd,
        args: parsed.rest,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'history': {
      const { runHistoryCommand } = await import('./commands/history.js');
      return runHistoryCommand({
        cwd,
        args: parsed.rest,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'memory': {
      const { runMemoryCommand } = await import('./commands/memory.js');
      return runMemoryCommand({
        args: parsed.rest,
        cwd,
        json: parsed.json === true,
        io: sessionIo,
      });
    }
    case 'error':
      sessionIo.writeStderr(`${parsed.errorMessage ?? 'mitii: invalid arguments'}\n`);
      return 2;
    case 'unknown':
      sessionIo.writeStderr(
        `mitii: unknown command "${parsed.unknownCommand ?? ''}"\n\n`,
      );
      sessionIo.writeStdout(CLI_HELP);
      return 2;
    default:
      sessionIo.writeStdout(CLI_HELP);
      return 0;
  }
}
