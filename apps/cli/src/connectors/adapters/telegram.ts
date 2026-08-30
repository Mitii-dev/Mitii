import type { AgentMode } from '@mitii/sdk';

import {
  isProcessRunning,
  listJsonStatePaths,
  parseBooleanFlag,
  parseStringFlag,
  readJsonFile,
  removeFile,
  resolveConnectorDir,
  sanitizeKey,
  terminateProcess,
  writeJsonFile,
} from '../common.js';
import { resetConnectorThread, runConnectorTurn } from '../host.js';
import type {
  ConnectCommandDefinition,
  ConnectIo,
  ConnectStopResult,
} from '../types.js';
import {
  getConnectorFirstContactMessage,
  getConnectorSystemRules,
} from './prompts.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_SYSTEM_RULES = getConnectorSystemRules('Telegram');
const FIRST_CONTACT = getConnectorFirstContactMessage();

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type TelegramConnectorState = {
  pid: number;
  botUsername: string;
  botId?: string;
  cwd: string;
  startedAt: string;
};

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  from?: TelegramUser;
  chat: TelegramChat;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok?: boolean;
  description?: string;
  result?: T;
};

type ConnectTelegramOptions = {
  botToken: string;
  botUsername?: string;
  cwd: string;
  mode: AgentMode;
  forceEcho: boolean;
  autoApprove: boolean;
  allowedUserIds: string[];
};

function normalizeBotUsername(value: string): string {
  return value.trim().replace(/^@+/, '');
}

function readBotId(botToken: string): string | undefined {
  const [botId] = botToken.trim().split(':', 1);
  return /^\d+$/.test(botId ?? '') ? botId : undefined;
}

function statePath(botUsername: string, cwd: string): string {
  return `${resolveConnectorDir('telegram', cwd)}/${sanitizeKey(botUsername)}.json`;
}

function helpText(): string {
  return [
    'Usage: mitii connect telegram [options]',
    '',
    'Options:',
    '  --token <token>              Bot token (or TELEGRAM_BOT_TOKEN)',
    '  --bot-username <name>        Bot username without @ (optional; fetched via getMe)',
    '  --cwd <path>                 Workspace root (default: process.cwd())',
    '  --mode <ask|plan|agent>      Agent mode (default: ask)',
    '  --echo                       Force EchoLlmPort',
    '  --approve                    Auto-approve mutations/plan gates (default)',
    '  --deny                       Do not auto-approve; deny on suspend',
    '  --allowed-user-id <id>       Restrict to Telegram user id (repeatable)',
    '  --stop                       Stop a running telegram connector for this bot',
    '  -h, --help                   Show this help',
    '',
    'Commands in chat:',
    '  /help       Show connector help',
    '  /new        Reset thread conversation',
    '  /whereami   Show chat / user ids',
  ].join('\n');
}

function parseAllowedUserIds(rawArgs: string[]): string[] {
  const ids: string[] = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    if (rawArgs[i] !== '--allowed-user-id') continue;
    const next = rawArgs[i + 1]?.trim();
    if (!next || next.startsWith('-')) {
      throw new Error('connect telegram --allowed-user-id requires a value');
    }
    if (!/^\d+$/.test(next)) {
      throw new Error(
        'connect telegram --allowed-user-id must contain digits only',
      );
    }
    ids.push(next);
    i += 1;
  }
  return ids;
}

function parseMode(raw: string | undefined): AgentMode {
  if (!raw || raw === 'ask' || raw === 'plan' || raw === 'agent') {
    return raw ?? 'ask';
  }
  throw new Error(
    `connect telegram --mode must be ask, plan, or agent (got "${raw}")`,
  );
}

function parseOptions(rawArgs: string[]): ConnectTelegramOptions {
  if (parseBooleanFlag(rawArgs, '-h') || parseBooleanFlag(rawArgs, '--help')) {
    throw new Error('__SHOW_HELP__');
  }
  const botToken =
    parseStringFlag(rawArgs, '-t', '--token') ??
    process.env.TELEGRAM_BOT_TOKEN?.trim() ??
    '';
  if (!botToken) {
    throw new Error(
      'connect telegram requires --token or TELEGRAM_BOT_TOKEN',
    );
  }
  const deny = parseBooleanFlag(rawArgs, '--deny');
  return {
    botToken,
    botUsername: parseStringFlag(rawArgs, '-u', '--bot-username'),
    cwd: parseStringFlag(rawArgs, '', '--cwd') ?? process.cwd(),
    mode: parseMode(parseStringFlag(rawArgs, '', '--mode')),
    forceEcho: parseBooleanFlag(rawArgs, '--echo'),
    autoApprove: !deny,
    allowedUserIds: parseAllowedUserIds(rawArgs),
  };
}

async function telegramApi<T>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const response = await fetchImpl(
    `${TELEGRAM_API_BASE}/bot${botToken}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const text = await response.text();
  let parsed: TelegramApiResponse<T>;
  try {
    parsed = JSON.parse(text) as TelegramApiResponse<T>;
  } catch {
    throw new Error(
      `Telegram ${method} failed (${response.status}): ${text.slice(0, 240)}`,
    );
  }
  if (!response.ok || parsed.ok !== true || parsed.result === undefined) {
    throw new Error(
      parsed.description
        ? `Telegram ${method} failed: ${parsed.description}`
        : `Telegram ${method} failed (${response.status})`,
    );
  }
  return parsed.result;
}

async function resolveBotUsername(
  options: ConnectTelegramOptions,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const configured = normalizeBotUsername(options.botUsername ?? '');
  if (configured) return configured;
  const me = await telegramApi<{ username?: string }>(
    options.botToken,
    'getMe',
    undefined,
    fetchImpl,
  );
  const username = normalizeBotUsername(me.username ?? '');
  if (!username) {
    throw new Error(
      'Telegram getMe did not return a bot username; pass --bot-username',
    );
  }
  return username;
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const chunks = chunkTelegramText(text);
  for (const chunk of chunks) {
    await telegramApi(
      botToken,
      'sendMessage',
      {
        chat_id: chatId,
        text: chunk,
      },
      fetchImpl,
    );
  }
}

function chunkTelegramText(text: string, max = 3900): string[] {
  const trimmed = text.trim() || ' ';
  if (trimmed.length <= max) return [trimmed];
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > max) {
    let split = remaining.lastIndexOf('\n', max);
    if (split < max * 0.5) split = max;
    chunks.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function isAuthorized(
  allowedUserIds: string[],
  from: TelegramUser | undefined,
): boolean {
  if (allowedUserIds.length === 0) return true;
  if (!from) return false;
  return allowedUserIds.includes(String(from.id));
}

async function stopTelegramConnector(
  options: { botUsername?: string; cwd: string },
  io: ConnectIo,
): Promise<number> {
  const paths = listJsonStatePaths('telegram', options.cwd);
  let stopped = 0;
  for (const path of paths) {
    const state = readJsonFile<TelegramConnectorState>(path);
    if (!state) continue;
    if (
      options.botUsername &&
      normalizeBotUsername(state.botUsername) !==
        normalizeBotUsername(options.botUsername)
    ) {
      continue;
    }
    if (state.pid && (await terminateProcess(state.pid))) {
      stopped += 1;
      io.writeln(`[telegram] stopped pid=${state.pid}`);
    }
    removeFile(path);
  }
  if (stopped === 0) {
    io.writeln('[telegram] no running connector found');
  }
  return 0;
}

async function handleChatCommand(input: {
  text: string;
  message: TelegramMessage;
  options: ConnectTelegramOptions;
  botUsername: string;
  botToken: string;
  io: ConnectIo;
  fetchImpl: FetchLike;
}): Promise<boolean> {
  const command = input.text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const bare = command.replace(/@[\w_]+$/i, '');
  if (bare === '/help') {
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      [
        FIRST_CONTACT,
        '',
        'Commands: /help /new /whereami',
        `Mode: ${input.options.mode}`,
        `Cwd: ${input.options.cwd}`,
      ].join('\n'),
      input.fetchImpl,
    );
    return true;
  }
  if (bare === '/new') {
    resetConnectorThread(
      'telegram',
      input.botUsername,
      String(input.message.chat.id),
      input.options.cwd,
    );
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      'Started a fresh Mitii session for this thread.',
      input.fetchImpl,
    );
    return true;
  }
  if (bare === '/whereami') {
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      [
        `chatId=${input.message.chat.id}`,
        `userId=${input.message.from?.id ?? 'unknown'}`,
        `bot=@${input.botUsername}`,
        `cwd=${input.options.cwd}`,
        `mode=${input.options.mode}`,
      ].join('\n'),
      input.fetchImpl,
    );
    return true;
  }
  return false;
}

async function processMessage(input: {
  message: TelegramMessage;
  options: ConnectTelegramOptions;
  botUsername: string;
  botToken: string;
  io: ConnectIo;
  fetchImpl: FetchLike;
  greeted: Set<string>;
}): Promise<void> {
  const text = input.message.text?.trim();
  if (!text) return;

  if (!isAuthorized(input.options.allowedUserIds, input.message.from)) {
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      'Unauthorized for this Mitii connector.',
      input.fetchImpl,
    );
    return;
  }

  const threadId = String(input.message.chat.id);
  if (!input.greeted.has(threadId)) {
    input.greeted.add(threadId);
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      FIRST_CONTACT,
      input.fetchImpl,
    );
  }

  if (
    await handleChatCommand({
      text,
      message: input.message,
      options: input.options,
      botUsername: input.botUsername,
      botToken: input.botToken,
      io: input.io,
      fetchImpl: input.fetchImpl,
    })
  ) {
    return;
  }

  input.io.writeln(
    `[telegram] turn chat=${threadId} user=${input.message.from?.id ?? '?'} text=${text.slice(0, 80)}`,
  );

  const prompt = [
    TELEGRAM_SYSTEM_RULES,
    '',
    `Telegram user: ${input.message.from?.username ?? input.message.from?.id ?? 'unknown'}`,
    `Chat id: ${threadId}`,
    '',
    text,
  ].join('\n');

  try {
    const result = await runConnectorTurn({
      adapterName: 'telegram',
      instanceKey: input.botUsername,
      threadId,
      prompt,
      cwd: input.options.cwd,
      mode: input.options.mode,
      forceEcho: input.options.forceEcho,
      autoApprove: input.options.autoApprove,
      io: input.io,
    });
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      result.answer,
      input.fetchImpl,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    input.io.writeErr(`[telegram] turn failed: ${detail}`);
    await sendTelegramMessage(
      input.botToken,
      input.message.chat.id,
      `Mitii error: ${detail.slice(0, 500)}`,
      input.fetchImpl,
    );
  }
}

async function runPollingLoop(
  options: ConnectTelegramOptions,
  botUsername: string,
  io: ConnectIo,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  const botId = readBotId(options.botToken);
  const path = statePath(botUsername, options.cwd);
  const existing = readJsonFile<TelegramConnectorState>(path);
  if (
    existing?.pid &&
    existing.pid !== process.pid &&
    isProcessRunning(existing.pid)
  ) {
    io.writeErr(
      `[telegram] already running pid=${existing.pid} bot=@${existing.botUsername}`,
    );
    return 1;
  }

  writeJsonFile(path, {
    pid: process.pid,
    botUsername,
    botId,
    cwd: options.cwd,
    startedAt: new Date().toISOString(),
  } satisfies TelegramConnectorState);

  io.writeln(
    `[telegram] listening as @${botUsername} cwd=${options.cwd} mode=${options.mode}`,
  );
  io.writeln('[telegram] Ctrl-C to stop');

  let offset = 0;
  let stopping = false;
  const greeted = new Set<string>();

  const onSignal = () => {
    stopping = true;
    io.writeln('[telegram] stopping…');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    while (!stopping) {
      let updates: TelegramUpdate[] = [];
      try {
        updates = await telegramApi<TelegramUpdate[]>(
          options.botToken,
          'getUpdates',
          {
            offset,
            timeout: 25,
            allowed_updates: ['message'],
          },
          fetchImpl,
        );
      } catch (error) {
        if (stopping) break;
        const detail = error instanceof Error ? error.message : String(error);
        io.writeErr(`[telegram] getUpdates error: ${detail}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        if (update.message) {
          await processMessage({
            message: update.message,
            options,
            botUsername,
            botToken: options.botToken,
            io,
            fetchImpl,
            greeted,
          });
        }
      }
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    removeFile(path);
  }

  return 0;
}

export const telegramConnector: ConnectCommandDefinition = {
  name: 'telegram',
  description:
    'Telegram Bot API long-poll bridge into Mitii CLI agent sessions',

  showHelp(io) {
    for (const line of helpText().split('\n')) {
      io.writeln(line);
    }
  },

  async stopAll(io) {
    const paths = listJsonStatePaths('telegram');
    let stoppedProcesses = 0;
    for (const path of paths) {
      const state = readJsonFile<TelegramConnectorState>(path);
      if (state?.pid && (await terminateProcess(state.pid))) {
        stoppedProcesses += 1;
        io.writeln(`[telegram] stopped pid=${state.pid}`);
      }
      removeFile(path);
    }
    return { stoppedProcesses } satisfies ConnectStopResult;
  },

  async run(rawArgs, io) {
    try {
      if (parseBooleanFlag(rawArgs, '--stop')) {
        const botUsername = parseStringFlag(rawArgs, '-u', '--bot-username');
        const cwd = parseStringFlag(rawArgs, '', '--cwd') ?? process.cwd();
        return stopTelegramConnector({ botUsername, cwd }, io);
      }
      const options = parseOptions(rawArgs);
      const botUsername = await resolveBotUsername(options);
      return runPollingLoop(options, botUsername, io);
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
