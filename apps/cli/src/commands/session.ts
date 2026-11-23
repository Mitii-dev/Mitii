import type { Readable, Writable } from 'node:stream';

import type {
  AgentMode,
  MitiiConversationMessage,
  TaskList,
} from '@mitii/sdk';
import { loadModeProfiles } from '@mitii/host';

import { formatSessionHeader } from '../banner.js';
import { newCliThreadSessionId } from '../cliLog.js';
import { loadMitiiHostConfig } from '../config.js';
import { readPackageVersion } from '../packageVersion.js';
import {
  createCliClient,
  resolveCliPorts,
  type CliRuntime,
} from '../ports.js';
import { runAsk } from '../runAskCommand.js';
import type { SessionIo } from '../session.js';
import { nextCliSessionCarry } from '../sessionCarry.js';
import { createSessionLineReader } from '../sessionLineReader.js';
import {
  createTermStyle,
  formatSessionPrompt,
} from '../termStyle.js';
import { runSlashCommand, type ReplSlashState } from './replSlash.js';

export interface RunSessionOptions {
  cwd: string;
  forceEcho: boolean;
  mode?: AgentMode;
  profile?: string;
  loopPolicyJson?: string;
  noLoopPolicy?: boolean;
  io: SessionIo;
  /** Test seams; production uses real stdin/stderr and the real client factory. */
  input?: Readable;
  output?: Writable;
  terminal?: boolean;
  createClient?: typeof createCliClient;
  runAskTurn?: typeof runAsk;
}

/**
 * Interactive REPL. One readline owns stdin for the whole session (turn
 * prompts and approvals), and one client + repository state is built lazily on
 * the first real prompt and reused for every later turn.
 */
export async function runSession(options: RunSessionOptions): Promise<number> {
  const createClient = options.createClient ?? createCliClient;
  const askTurn = options.runAskTurn ?? runAsk;
  const reader = createSessionLineReader({
    input: options.input,
    output: options.output,
    terminal: options.terminal,
  });
  const io = reader.createSessionIo(options.io);
  const style = createTermStyle(
    options.terminal === false ? { isTTY: false } : process.stderr,
  );

  const ports = resolveCliPorts({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const slashState: ReplSlashState = {
    mode: options.mode ?? ports.defaultMode,
    profile:
      options.profile ??
      loadModeProfiles(options.cwd).activeSlug ??
      undefined,
  };
  const config = loadMitiiHostConfig(options.cwd);
  const hasConfiguredProvider =
    (Boolean(config.provider) && config.provider !== 'echo') ||
    (Boolean(config.providerPreset) && config.providerPreset !== 'echo');

  io.writeStderr(
    formatSessionHeader({
      cwd: options.cwd,
      providerLabel: ports.providerLabel,
      mode: slashState.mode,
      version: readPackageVersion(),
      isEcho: ports.providerLabel === 'echo' || options.forceEcho,
      showSetupHint:
        ports.providerLabel === 'echo' &&
        !options.forceEcho &&
        !hasConfiguredProvider,
      profile: slashState.profile ?? null,
      style,
    }),
  );

  let runtime: CliRuntime | undefined;
  let conversation: MitiiConversationMessage[] = [];
  let taskList: TaskList | undefined;
  let sessionId = newCliThreadSessionId();
  const promptPrefix = formatSessionPrompt(style);

  try {
    for (;;) {
      const line = await reader.readLine(promptPrefix);
      if (line === null) break; // EOF
      const prompt = line.trim();
      if (!prompt) continue;

      const slash = await runSlashCommand(prompt, {
        cwd: options.cwd,
        io,
        state: slashState,
        forceEcho: options.forceEcho,
      });
      if (slash === 'exit') break;
      if (slash === 'clear') {
        conversation = [];
        taskList = undefined;
        sessionId = newCliThreadSessionId();
        continue;
      }
      if (slash === 'continue') continue;

      if (!runtime) {
        try {
          runtime = await createClient({
            cwd: options.cwd,
            forceEcho: options.forceEcho,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          io.writeStderr(
            `${style.danger('[mitii] cannot start client:')} ${message}\n`,
          );
          continue;
        }
      }

      const { code, mode: runMode, outcome } = await askTurn({
        prompt,
        cwd: options.cwd,
        json: false,
        forceEcho: options.forceEcho,
        mode: slashState.mode,
        profile: slashState.profile,
        conversation,
        taskList,
        sessionId,
        loopPolicyJson: options.loopPolicyJson,
        noLoopPolicy: options.noLoopPolicy,
        io,
        runtime,
      });
      if (outcome) {
        const next = nextCliSessionCarry({
          mode: runMode,
          conversation,
          taskList,
          prompt,
          result: outcome.result,
          contextWindowTokens:
            runtime.ports.runLlm.capabilities.contextWindowTokens,
        });
        conversation = next.conversation;
        taskList = next.taskList;
      }
      if (code === 130) {
        io.writeStderr(`${style.warn('[mitii] run cancelled')}\n`);
      }
    }
  } finally {
    reader.close();
  }
  return 0;
}
