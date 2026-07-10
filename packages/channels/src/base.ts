import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { DaemonClient, DaemonSessionClient } from '../../sdk/src';
import type { MitiiMode } from '../../sdk/src';

export interface ChannelMessage {
  channel: string;
  threadId: string;
  userId: string;
  text: string;
}

export interface ChannelSecurityPolicy {
  allowedUsers?: string[];
  allowedThreads?: string[];
  readOnly?: boolean;
  maxPromptChars?: number;
}

export interface ChannelRuntimeOptions {
  daemonUrl: string;
  daemonToken?: string;
  cwd: string;
  sessionStorePath: string;
  security?: ChannelSecurityPolicy;
}

export class ChannelRuntimeAdapter {
  private readonly client: DaemonClient;
  private readonly sessions: Record<string, string>;

  constructor(private readonly options: ChannelRuntimeOptions) {
    this.client = new DaemonClient({ baseUrl: options.daemonUrl, token: options.daemonToken });
    this.sessions = readJson<Record<string, string>>(options.sessionStorePath, {});
  }

  async prompt(message: ChannelMessage, mode: MitiiMode = 'agent'): Promise<string> {
    const policy = this.options.security ?? {};
    if (policy.allowedUsers?.length && !policy.allowedUsers.includes(message.userId)) {
      return 'This user is not allowed to use Mitii from this channel.';
    }
    if (policy.allowedThreads?.length && !policy.allowedThreads.includes(message.threadId)) {
      return 'This channel thread is not allowlisted for Mitii.';
    }
    const safeMode = policy.readOnly && mode === 'agent' ? 'plan' : mode;
    const text = sanitizeOutbound(message.text).slice(0, policy.maxPromptChars ?? 12_000);
    const session = await this.getOrCreateSession(message.threadId, safeMode);
    const events = session.events();
    await session.prompt({ mode: safeMode, message: text });
    let output = '';
    for await (const event of events) {
      if (event.type === 'assistant_delta') output += event.content;
      if (event.type === 'error') return `Mitii error: ${event.message}`;
      if (event.type === 'approval_required') output += `\nApproval required: ${event.tool}\n`;
      if (event.type === 'done') break;
    }
    return sanitizeOutbound(output || 'Mitii completed without assistant output.');
  }

  private async getOrCreateSession(threadId: string, mode: MitiiMode): Promise<DaemonSessionClient> {
    const existing = this.sessions[threadId];
    if (existing) {
      return new DaemonSessionClient(this.client, await this.client.getSession(existing));
    }
    const session = await this.client.createSession({
      cwd: this.options.cwd,
      mode,
      approval: 'manual',
      runtime: 'real',
    });
    this.sessions[threadId] = session.id;
    writeJson(this.options.sessionStorePath, this.sessions);
    return new DaemonSessionClient(this.client, session);
  }
}

export function sanitizeOutbound(value: string): string {
  return value.replace(/\b[A-Za-z0-9_=-]{24,}\b/g, '[redacted]');
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
