import { homedir } from 'os';
import { join } from 'path';
import { ChannelRuntimeAdapter, type ChannelRuntimeOptions } from './base';
import type { MitiiMode } from '../../sdk/src';

export interface TelegramConnectorOptions extends Omit<ChannelRuntimeOptions, 'sessionStorePath'> {
  token: string;
  pollTimeoutSeconds?: number;
  sessionStorePath?: string;
}

export class TelegramConnector {
  private readonly runtime: ChannelRuntimeAdapter;
  private offset = 0;

  constructor(private readonly options: TelegramConnectorOptions) {
    this.runtime = new ChannelRuntimeAdapter({
      ...options,
      sessionStorePath: options.sessionStorePath ?? join(homedir(), '.mitii', 'connectors', 'telegram-sessions.json'),
    });
  }

  async start(): Promise<void> {
    while (true) {
      const updates = await this.request<{ ok: boolean; result: TelegramUpdate[] }>('getUpdates', {
        offset: this.offset,
        timeout: this.options.pollTimeoutSeconds ?? 30,
      });
      for (const update of updates.result ?? []) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        const message = update.message;
        if (!message?.text) continue;
        const { mode, text } = parseTelegramCommand(message.text);
        const reply = await this.runtime.prompt({
          channel: 'telegram',
          threadId: String(message.chat.id),
          userId: String(message.from?.id ?? message.chat.id),
          text,
        }, mode);
        await this.request('sendMessage', {
          chat_id: message.chat.id,
          text: reply.slice(0, 3900),
          reply_to_message_id: message.message_id,
        });
      }
    }
  }

  private async request<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.options.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Telegram ${method} failed with ${response.status}`);
    return await response.json() as T;
  }
}

function parseTelegramCommand(input: string): { mode: MitiiMode; text: string } {
  const trimmed = input.trim();
  const [command, ...rest] = trimmed.split(/\s+/);
  if (command === '/ask') return { mode: 'ask', text: rest.join(' ') };
  if (command === '/plan') return { mode: 'plan', text: rest.join(' ') };
  if (command === '/agent') return { mode: 'agent', text: rest.join(' ') };
  if (command === '/status') return { mode: 'ask', text: 'Summarize the current Mitii session status.' };
  if (command === '/cancel') return { mode: 'ask', text: 'Cancel is not available from this connector yet.' };
  return { mode: 'agent', text: trimmed };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number };
    from?: { id: number };
  };
}
