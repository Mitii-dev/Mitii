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

const SYSTEM_RULES = getConnectorSystemRules('Discord');
const FIRST_CONTACT = getConnectorFirstContactMessage();
const DISCORD_API = 'https://discord.com/api/v10';

type DiscordOptions = SharedConnectOptions & {
  botToken: string;
};

type DiscordState = {
  pid: number;
  cwd: string;
  startedAt: string;
};

type GatewayPayload = {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
};

type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author?: { id: string; username?: string; bot?: boolean };
  mentions?: Array<{ id: string }>;
};

function helpText(): string {
  return [
    'Usage: mitii connect discord [options]',
    '',
    'Options:',
    '  --token <token>              Bot token (or DISCORD_BOT_TOKEN)',
    '  --cwd <path>                 Workspace root (default: process.cwd())',
    '  --mode <ask|plan|agent>      Agent mode (default: ask)',
    '  --echo                       Force EchoLlmPort',
    '  --approve                    Auto-approve mutations/plan gates (default)',
    '  --deny                       Do not auto-approve; deny on suspend',
    '  --allowed-user-id <id>       Restrict to Discord user id (repeatable)',
    '  --stop                       Stop a running discord connector',
    '  -h, --help                   Show this help',
    '',
    'In guild channels the bot only replies when @mentioned.',
    'DMs are always accepted (subject to allowlist).',
    '',
    'Commands in chat:',
    '  /help       Show connector help',
    '  /new        Reset thread conversation',
    '  /whereami   Show channel / user ids',
  ].join('\n');
}

function parseOptions(rawArgs: string[]): DiscordOptions {
  const shared = parseSharedConnectOptions(rawArgs);
  const botToken =
    parseStringFlag(rawArgs, '-t', '--token') ??
    process.env.DISCORD_BOT_TOKEN?.trim() ??
    '';
  if (!botToken) {
    throw new Error(
      'connect discord requires --token or DISCORD_BOT_TOKEN',
    );
  }
  return { ...shared, botToken };
}

function statePath(cwd: string): string {
  return join(resolveConnectorDir('discord', cwd), 'default.json');
}

function resolveWebSocket(): typeof WebSocket {
  const ws = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!ws) {
    throw new Error(
      'connect discord requires Node.js with global WebSocket (Node 22+ recommended)',
    );
  }
  return ws;
}

async function discordApi<T>(
  botToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Discord API ${method} ${path} failed (${response.status}): ${text.slice(0, 240)}`,
    );
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function sendChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
): Promise<void> {
  for (const chunk of chunkMessageText(content, 1900)) {
    await discordApi(botToken, 'POST', `/channels/${channelId}/messages`, {
      content: chunk,
    });
  }
}

function stripMentions(content: string, botUserId: string): string {
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, 'g'), '')
    .replace(/<@&\d+>/g, '')
    .trim();
}

function shouldHandle(
  message: DiscordMessage,
  botUserId: string,
): boolean {
  if (!message.author || message.author.bot) return false;
  if (!message.guild_id) return true;
  return (message.mentions ?? []).some((m) => m.id === botUserId);
}

async function handleSlash(input: {
  bare: string;
  message: DiscordMessage;
  options: DiscordOptions;
  botToken: string;
}): Promise<boolean> {
  const channelId = input.message.channel_id;
  if (input.bare === '/help') {
    await sendChannelMessage(
      input.botToken,
      channelId,
      [
        FIRST_CONTACT,
        '',
        'Commands: /help /new /whereami',
        `Mode: ${input.options.mode}`,
        `Cwd: ${input.options.cwd}`,
      ].join('\n'),
    );
    return true;
  }
  if (input.bare === '/new') {
    resetConnectorThread(
      'discord',
      'default',
      channelId,
      input.options.cwd,
    );
    await sendChannelMessage(
      input.botToken,
      channelId,
      'Started a fresh Mitii session for this channel.',
    );
    return true;
  }
  if (input.bare === '/whereami') {
    await sendChannelMessage(
      input.botToken,
      channelId,
      [
        `channelId=${channelId}`,
        `userId=${input.message.author?.id ?? 'unknown'}`,
        `guildId=${input.message.guild_id ?? 'dm'}`,
        `cwd=${input.options.cwd}`,
        `mode=${input.options.mode}`,
      ].join('\n'),
    );
    return true;
  }
  return false;
}

async function runDiscord(
  options: DiscordOptions,
  io: ConnectIo,
): Promise<number> {
  const path = statePath(options.cwd);
  if (!assertNotAlreadyRunning(path, io, 'discord')) {
    return 1;
  }

  const gateway = await discordApi<{ url: string }>(
    options.botToken,
    'GET',
    '/gateway/bot',
  );
  const me = await discordApi<{ id: string; username: string }>(
    options.botToken,
    'GET',
    '/users/@me',
  );
  const botUserId = me.id;

  writeJsonFile(path, {
    pid: process.pid,
    cwd: options.cwd,
    startedAt: new Date().toISOString(),
  } satisfies DiscordState);

  const WebSocketImpl = resolveWebSocket();
  const ws = new WebSocketImpl(`${gateway.url}/?v=10&encoding=json`);
  let sequence: number | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let stopping = false;
  const greeted = new Set<string>();

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    io.writeln('[discord] stopping…');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    removeFile(path);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const identify = () => {
    ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: options.botToken,
          intents: (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15),
          // GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
          properties: {
            os: process.platform,
            browser: 'mitii',
            device: 'mitii',
          },
        },
      }),
    );
  };

  const onMessageCreate = async (message: DiscordMessage) => {
    if (!shouldHandle(message, botUserId)) return;
    const userId = message.author?.id;
    if (!isAuthorizedUser(options.allowedUserIds, userId)) {
      await sendChannelMessage(
        options.botToken,
        message.channel_id,
        'Unauthorized for this Mitii connector.',
      );
      return;
    }

    const text = stripMentions(message.content ?? '', botUserId);
    if (!text) return;

    const threadId = message.channel_id;
    if (!greeted.has(threadId)) {
      greeted.add(threadId);
      await sendChannelMessage(options.botToken, threadId, FIRST_CONTACT);
    }

    const bare = normalizeSlashCommand(text);
    if (
      await handleSlash({
        bare,
        message,
        options,
        botToken: options.botToken,
      })
    ) {
      return;
    }

    io.writeln(
      `[discord] turn channel=${threadId} user=${userId ?? '?'} text=${text.slice(0, 80)}`,
    );

    const prompt = [
      SYSTEM_RULES,
      '',
      `Discord user: ${message.author?.username ?? userId ?? 'unknown'}`,
      `Channel id: ${threadId}`,
      '',
      text,
    ].join('\n');

    try {
      const result = await runConnectorTurn({
        adapterName: 'discord',
        instanceKey: 'default',
        threadId,
        prompt,
        cwd: options.cwd,
        mode: options.mode,
        forceEcho: options.forceEcho,
        autoApprove: options.autoApprove,
        io,
      });
      await sendChannelMessage(options.botToken, threadId, result.answer);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      io.writeErr(`[discord] turn failed: ${detail}`);
      await sendChannelMessage(
        options.botToken,
        threadId,
        `Mitii error: ${detail.slice(0, 500)}`,
      );
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => {
      io.writeln(
        `[discord] listening as ${me.username} cwd=${options.cwd} mode=${options.mode}`,
      );
      io.writeln('[discord] Ctrl-C to stop');
    });

    ws.addEventListener('message', (event) => {
      void (async () => {
        try {
          const payload = JSON.parse(String(event.data)) as GatewayPayload;
          if (typeof payload.s === 'number') sequence = payload.s;

          if (payload.op === 10) {
            const interval =
              (payload.d as { heartbeat_interval?: number })
                ?.heartbeat_interval ?? 41250;
            heartbeatTimer = setInterval(() => {
              if (ws.readyState === WebSocketImpl.OPEN) {
                ws.send(JSON.stringify({ op: 1, d: sequence }));
              }
            }, interval);
            identify();
            return;
          }

          if (payload.op === 0 && payload.t === 'MESSAGE_CREATE') {
            await onMessageCreate(payload.d as DiscordMessage);
          }
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : String(error);
          io.writeErr(`[discord] gateway error: ${detail}`);
        }
      })();
    });

    ws.addEventListener('close', () => {
      shutdown();
      resolve();
    });
    ws.addEventListener('error', () => {
      if (!stopping) {
        reject(new Error('Discord gateway websocket error'));
      }
    });
  });

  return 0;
}

export const discordConnector: ConnectCommandDefinition = {
  name: 'discord',
  description: 'Discord bot gateway bridge into Mitii CLI agent sessions',

  showHelp(io) {
    for (const line of helpText().split('\n')) {
      io.writeln(line);
    }
  },

  async stopAll(io) {
    const stoppedProcesses = await stopAllAdapterProcesses('discord', io);
    return { stoppedProcesses } satisfies ConnectStopResult;
  },

  async run(rawArgs, io) {
    try {
      if (parseBooleanFlag(rawArgs, '--stop')) {
        const cwd = parseStringFlag(rawArgs, '', '--cwd') ?? process.cwd();
        await stopConnectorInstances({
          adapterName: 'discord',
          cwd,
          io,
          label: 'discord',
        });
        return 0;
      }
      const options = parseOptions(rawArgs);
      return await runDiscord(options, io);
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
