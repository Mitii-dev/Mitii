import type { DeliverySender } from '@mitii/automation';

import { formatDeliveryMessage } from './formatMessage.js';

export interface CreateChatDeliverySenderOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/**
 * HTTP senders for Slack / Discord / Telegram using env tokens.
 * Targets are channel/chat ids from spec metadata.delivery[].target.
 */
export function createChatDeliverySender(
  options: CreateChatDeliverySenderOptions = {},
): DeliverySender {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(input) {
      const text = formatDeliveryMessage(input);
      try {
        if (input.adapter === 'slack') {
          const token =
            tokenFromTarget(input.target) ??
            env.SLACK_BOT_TOKEN ??
            env.MITII_SLACK_BOT_TOKEN;
          if (!token) {
            return { ok: false, error: 'missing SLACK_BOT_TOKEN' };
          }
          await slackPost(fetchImpl, token, input.target.target, text);
          return { ok: true };
        }
        if (input.adapter === 'discord') {
          const token =
            tokenFromTarget(input.target) ??
            env.DISCORD_BOT_TOKEN ??
            env.MITII_DISCORD_BOT_TOKEN;
          if (!token) {
            return { ok: false, error: 'missing DISCORD_BOT_TOKEN' };
          }
          await discordPost(fetchImpl, token, input.target.target, text);
          return { ok: true };
        }
        if (input.adapter === 'telegram') {
          const token =
            tokenFromTarget(input.target) ??
            env.TELEGRAM_BOT_TOKEN ??
            env.MITII_TELEGRAM_BOT_TOKEN;
          if (!token) {
            return { ok: false, error: 'missing TELEGRAM_BOT_TOKEN' };
          }
          await telegramPost(fetchImpl, token, input.target.target, text);
          return { ok: true };
        }
        return {
          ok: false,
          error: `chat sender cannot handle adapter=${input.adapter}`,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function tokenFromTarget(target: {
  metadata?: Record<string, unknown>;
}): string | undefined {
  const token = target.metadata?.token;
  return typeof token === 'string' && token.trim() ? token.trim() : undefined;
}

async function slackPost(
  fetchImpl: typeof fetch,
  token: string,
  channel: string,
  text: string,
): Promise<void> {
  for (const chunk of chunkText(text, 3500)) {
    const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text: chunk }),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || payload.ok === false) {
      throw new Error(`Slack chat.postMessage: ${payload.error ?? response.status}`);
    }
  }
}

async function discordPost(
  fetchImpl: typeof fetch,
  token: string,
  channelId: string,
  content: string,
): Promise<void> {
  for (const chunk of chunkText(content, 1900)) {
    const response = await fetchImpl(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bot ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ content: chunk }),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Discord message ${response.status}: ${body.slice(0, 200)}`);
    }
  }
}

async function telegramPost(
  fetchImpl: typeof fetch,
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  for (const chunk of chunkText(text, 3900)) {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      },
    );
    const payload = (await response.json()) as {
      ok?: boolean;
      description?: string;
    };
    if (!response.ok || payload.ok === false) {
      throw new Error(
        `Telegram sendMessage: ${payload.description ?? response.status}`,
      );
    }
  }
}

function chunkText(text: string, max: number): string[] {
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
