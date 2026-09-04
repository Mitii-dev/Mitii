import { join } from 'node:path';

import {
  parseBooleanFlag,
  parseStringFlag,
  resolveConnectorDir,
  writeJsonFile,
  removeFile,
} from '../common.js';
import { resetConnectorThread, runConnectorTurn } from '../host.js';
import {
  assertNotAlreadyRunning,
  chunkMessageText,
  isAuthorizedUser,
  normalizeSlashCommand,
  parseSharedConnectOptions,
  stopAllAdapterProcesses,
  stopConnectorInstances,
  type SharedConnectOptions,
} from '../shared-options.js';
import type {
  ConnectCommandDefinition,
  ConnectIo,
  ConnectStopResult,
} from '../types.js';
import {
  getConnectorFirstContactMessage,
  getConnectorSystemRules,
} from './prompts.js';

const SYSTEM_RULES = getConnectorSystemRules('Slack');
const FIRST_CONTACT = getConnectorFirstContactMessage();
const SLACK_API = 'https://slack.com/api';

type SlackOptions = SharedConnectOptions & {
  botToken: string;
  appToken: string;
};

type SlackState = {
  pid: number;
  cwd: string;
  startedAt: string;
};

type SlackEnvelope = {
  envelope_id?: string;
  type?: string;
  payload?: {
    token?: string;
    team_id?: string;
    event?: SlackEvent;
    type?: string;
  };
};

type SlackEvent = {
  type?: string;
  user?: string;
  text?: string;
  channel?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  channel_type?: string;
};

function helpText(): string {
  return [
    'Usage: mitii connect slack [options]',
    '',
    'Options:',
    '  --bot-token <token>          Bot token xoxb-… (or SLACK_BOT_TOKEN)',
    '  --app-token <token>          App-level token xapp-… (or SLACK_APP_TOKEN)',
    '  --cwd <path>                 Workspace root (default: process.cwd())',
    '  --mode <ask|plan|agent>      Agent mode (default: ask)',
    '  --echo                       Force EchoLlmPort',
    '  --approve                    Auto-approve mutations/plan gates (default)',
    '  --deny                       Do not auto-approve; deny on suspend',
    '  --allowed-user-id <id>       Restrict to Slack user id (repeatable)',
    '  --stop                       Stop a running slack connector',
    '  -h, --help                   Show this help',
    '',
    'Uses Slack Socket Mode (no public webhook URL required).',
    '',
    'Commands in chat:',
    '  /help       Show connector help',
    '  /new        Reset thread conversation',
    '  /whereami   Show channel / user ids',
  ].join('\n');
}

function parseOptions(rawArgs: string[]): SlackOptions {
  const shared = parseSharedConnectOptions(rawArgs);
  const botToken =
    parseStringFlag(rawArgs, '', '--bot-token') ??
    process.env.SLACK_BOT_TOKEN?.trim() ??
    '';
  const appToken =
    parseStringFlag(rawArgs, '', '--app-token') ??
    process.env.SLACK_APP_TOKEN?.trim() ??
    '';
  if (!botToken) {
    throw new Error(
      'connect slack requires --bot-token or SLACK_BOT_TOKEN',
    );
  }
  if (!appToken) {
    throw new Error(
      'connect slack requires --app-token or SLACK_APP_TOKEN',
    );
  }
  return { ...shared, botToken, appToken };
}

function statePath(cwd: string): string {
  return join(resolveConnectorDir('slack', cwd), 'default.json');
}

function resolveWebSocket(): typeof WebSocket {
  const ws = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!ws) {
    throw new Error(
      'connect slack requires Node.js with global WebSocket (Node 22+ recommended)',
    );
  }
  return ws;
}

async function slackApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response.ok || payload.ok === false) {
    throw new Error(
      `Slack ${method} failed: ${payload.error ?? response.statusText}`,
    );
  }
  return payload;
}

function stripSlackMentions(text: string): string {
  return text.replace(/<@[UW][A-Z0-9]+>/gi, '').trim();
}

async function postMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  for (const chunk of chunkMessageText(text, 3500)) {
    await slackApi(botToken, 'chat.postMessage', {
      channel,
      text: chunk,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
  }
}

async function runSlack(options: SlackOptions, io: ConnectIo): Promise<number> {
  const path = statePath(options.cwd);
  if (!assertNotAlreadyRunning(path, io, 'slack')) {
    return 1;
  }

  const opened = await slackApi<{ url: string }>(
    options.appToken,
    'apps.connections.open',
  );

  writeJsonFile(path, {
    pid: process.pid,
    cwd: options.cwd,
    startedAt: new Date().toISOString(),
  } satisfies SlackState);

  const WebSocketImpl = resolveWebSocket();
  const ws = new WebSocketImpl(opened.url);
  let stopping = false;
  const greeted = new Set<string>();

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    io.writeln('[slack] stopping…');
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    removeFile(path);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const ack = (envelopeId: string) => {
    if (ws.readyState === WebSocketImpl.OPEN) {
      ws.send(JSON.stringify({ envelope_id: envelopeId }));
    }
  };

  const handleEvent = async (event: SlackEvent) => {
    if (event.type !== 'message') return;
    if (event.bot_id || event.subtype) return;
    if (!event.user || !event.channel || !event.text) return;

    if (!isAuthorizedUser(options.allowedUserIds, event.user)) {
      await postMessage(
        options.botToken,
        event.channel,
        'Unauthorized for this Mitii connector.',
        event.thread_ts,
      );
      return;
    }

    const text = stripSlackMentions(event.text);
    if (!text) return;

    const threadId = event.thread_ts
      ? `${event.channel}:${event.thread_ts}`
      : event.channel;

    if (!greeted.has(threadId)) {
      greeted.add(threadId);
      await postMessage(
        options.botToken,
        event.channel,
        FIRST_CONTACT,
        event.thread_ts,
      );
    }

    const bare = normalizeSlashCommand(text);
    if (bare === '/help') {
      await postMessage(
        options.botToken,
        event.channel,
        [
          FIRST_CONTACT,
          '',
          'Commands: /help /new /whereami',
          `Mode: ${options.mode}`,
          `Cwd: ${options.cwd}`,
        ].join('\n'),
        event.thread_ts,
      );
      return;
    }
    if (bare === '/new') {
      resetConnectorThread('slack', 'default', threadId, options.cwd);
      await postMessage(
        options.botToken,
        event.channel,
        'Started a fresh Mitii session for this thread.',
        event.thread_ts,
      );
      return;
    }
    if (bare === '/whereami') {
      await postMessage(
        options.botToken,
        event.channel,
        [
          `channelId=${event.channel}`,
          `userId=${event.user}`,
          `threadId=${threadId}`,
          `cwd=${options.cwd}`,
          `mode=${options.mode}`,
        ].join('\n'),
        event.thread_ts,
      );
      return;
    }

    io.writeln(
      `[slack] turn channel=${event.channel} user=${event.user} text=${text.slice(0, 80)}`,
    );

    const prompt = [
      SYSTEM_RULES,
      '',
      `Slack user: ${event.user}`,
      `Channel id: ${event.channel}`,
      '',
      text,
    ].join('\n');

    try {
      const result = await runConnectorTurn({
        adapterName: 'slack',
        instanceKey: 'default',
        threadId,
        prompt,
        cwd: options.cwd,
        mode: options.mode,
        forceEcho: options.forceEcho,
        autoApprove: options.autoApprove,
        io,
      });
      await postMessage(
        options.botToken,
        event.channel,
        result.answer,
        event.thread_ts,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      io.writeErr(`[slack] turn failed: ${detail}`);
      await postMessage(
        options.botToken,
        event.channel,
        `Mitii error: ${detail.slice(0, 500)}`,
        event.thread_ts,
      );
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => {
      io.writeln(
        `[slack] listening (socket mode) cwd=${options.cwd} mode=${options.mode}`,
      );
      io.writeln('[slack] Ctrl-C to stop');
    });

    ws.addEventListener('message', (event) => {
      void (async () => {
        try {
          const envelope = JSON.parse(String(event.data)) as SlackEnvelope;
          if (envelope.envelope_id) {
            ack(envelope.envelope_id);
          }
          if (envelope.type === 'events_api' && envelope.payload?.event) {
            await handleEvent(envelope.payload.event);
          }
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : String(error);
          io.writeErr(`[slack] socket error: ${detail}`);
        }
      })();
    });

    ws.addEventListener('close', () => {
      shutdown();
      resolve();
    });
    ws.addEventListener('error', () => {
      if (!stopping) {
        reject(new Error('Slack socket-mode websocket error'));
      }
    });
  });

  return 0;
}

export const slackConnector: ConnectCommandDefinition = {
  name: 'slack',
  description: 'Slack Socket Mode bridge into Mitii CLI agent sessions',

  showHelp(io) {
    for (const line of helpText().split('\n')) {
      io.writeln(line);
    }
  },

  async stopAll(io) {
    const stoppedProcesses = await stopAllAdapterProcesses('slack', io);
    return { stoppedProcesses } satisfies ConnectStopResult;
  },

  async run(rawArgs, io) {
    try {
      if (parseBooleanFlag(rawArgs, '--stop')) {
        const cwd = parseStringFlag(rawArgs, '', '--cwd') ?? process.cwd();
        await stopConnectorInstances({
          adapterName: 'slack',
          cwd,
          io,
          label: 'slack',
        });
        return 0;
      }
      const options = parseOptions(rawArgs);
      return await runSlack(options, io);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === '__SHOW_HELP__') {
        this.showHelp(io);
        return 0;
      }
      io.writeErr(message);
      return 1;
    }
  },
};
