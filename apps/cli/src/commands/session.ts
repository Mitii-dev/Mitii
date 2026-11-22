import type { Readable, Writable } from 'node:stream';

import type {
  AgentMode,
  MitiiConversationMessage,
  TaskList,
} from '@mitii/sdk';

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
import { runSlashCommand } from './replSlash.js';

export interface RunSessionOptions {
  cwd: string;
  forceEcho: boolean;
  mode?: AgentMode;
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

  const ports = resolveCliPorts({
    cwd: options.cwd,
    forceEcho: options.forceEcho,
  });
  const mode = options.mode ?? ports.defaultMode;
  const config = loadMitiiHostConfig(options.cwd);
  const hasConfiguredProvider =
    (Boolean(config.provider) && config.provider !== 'echo') ||
    (Boolean(config.providerPreset) && config.providerPreset !== 'echo');
  io.writeStderr(
    formatSessionHeader({
      cwd: options.cwd,
      providerLabel: ports.providerLabel,
      mode,
      version: readPackageVersion(),
      isEcho: ports.providerLabel === 'echo' || options.forceEcho,
      showSetupHint:
        ports.providerLabel === 'echo' &&
        !options.forceEcho &&
        !hasConfiguredProvider,
    }),
  );
  io.writeStderr('[mitii] type /help for session commands, /exit to quit\n');

  let runtime: CliRuntime | undefined;
  let conversation: MitiiConversationMessage[] = [];
  let taskList: TaskList | undefined;
  let sessionId = newCliThreadSessionId();
  try {
    for (;;) {
      const line = await reader.readLine('mitii> ');
      if (line === null) break; // EOF
      const prompt = line.trim();
      if (!prompt) continue;

      const slash = runSlashCommand(prompt, io);
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
          io.writeStderr(`[mitii] cannot start client: ${message}\n`);
          continue;
        }
      }

      const { code, mode: runMode, outcome } = await askTurn({
        prompt,
        cwd: options.cwd,
        json: false,
        forceEcho: options.forceEcho,
        mode: options.mode,
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
          contextWindowTokens: runtime.ports.runLlm.capabilities.contextWindowTokens,
        });
        conversation = next.conversation;
        taskList = next.taskList;
      }
      if (code === 130) {
        io.writeStderr('[mitii] run cancelled\n');
      }
    }
  } finally {
    reader.close();
  }
  return 0;
}
