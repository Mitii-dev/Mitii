import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { HeadlessAgentHost } from '../../../src/adapters/node/HeadlessAgentHost';
import type { HeadlessAgentOptions } from '../../../src/adapters/node/HeadlessConfig';
import type { MitiiApprovalDecision, MitiiMode } from '../../../src/adapters/node/events';
import { SseHub } from './sseHub';
import { canonicalWorkspace } from './workspaceBinding';

export interface DaemonSessionCreateOptions {
  cwd?: string;
  mode?: MitiiMode;
  approval?: 'auto' | 'manual';
  providerType?: HeadlessAgentOptions['providerType'];
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  runtime?: HeadlessAgentOptions['runtime'];
  indexWorkspace?: boolean;
}

export interface DaemonSessionInfo {
  id: string;
  cwd: string;
  mode: MitiiMode;
  approval: 'auto' | 'manual';
  createdAt: number;
  updatedAt: number;
  running: boolean;
  closed: boolean;
}

interface ManagedSession {
  info: DaemonSessionInfo;
  host: HeadlessAgentHost;
  abortController?: AbortController;
  promptInFlight: boolean;
}

export interface SessionManagerOptions {
  cwd: string;
  maxSessions: number;
  packageRoot?: string;
  sseHub: SseHub;
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly cwd: string;
  private readonly registryPath: string;
  private readonly auditPath: string;

  constructor(private readonly options: SessionManagerOptions) {
    this.cwd = canonicalWorkspace(options.cwd);
    this.registryPath = join(this.cwd, '.mitii', 'daemon', 'sessions.json');
    this.auditPath = join(this.cwd, '.mitii', 'daemon', 'audit.jsonl');
    mkdirSync(dirname(this.registryPath), { recursive: true });
  }

  list(): DaemonSessionInfo[] {
    return [...this.sessions.values()].map((session) => ({ ...session.info }));
  }

  get(id: string): DaemonSessionInfo | undefined {
    const session = this.sessions.get(id);
    return session ? { ...session.info } : undefined;
  }

  async create(options: DaemonSessionCreateOptions = {}): Promise<DaemonSessionInfo> {
    if (this.sessions.size >= this.options.maxSessions) {
      throw new SessionLimitError(`Maximum sessions reached (${this.options.maxSessions})`);
    }
    const id = randomUUID();
    const mode = options.mode ?? 'agent';
    const approval = options.approval ?? 'manual';
    const host = new HeadlessAgentHost({
      cwd: this.cwd,
      packageRoot: this.options.packageRoot,
      runtime: options.runtime,
      providerType: options.providerType,
      baseUrl: options.baseUrl,
      model: options.model,
      apiKey: options.apiKey,
      approval,
      indexWorkspace: options.indexWorkspace,
      sessionId: id,
      onEvent: (event) => this.options.sseHub.publish(id, event),
    });
    await host.initialize();
    const info: DaemonSessionInfo = {
      id,
      cwd: this.cwd,
      mode,
      approval,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      running: false,
      closed: false,
    };
    this.sessions.set(id, { info, host, promptInFlight: false });
    this.persist();
    this.audit('session_create', { id, mode, approval });
    return { ...info };
  }

  async prompt(id: string, input: { mode?: MitiiMode; message: string; attachments?: unknown[] }): Promise<{ accepted: true }> {
    const session = this.sessions.get(id);
    if (!session || session.info.closed) throw new SessionNotFoundError(id);
    if (session.promptInFlight) throw new SessionConflictError('A prompt is already running for this session');
    session.promptInFlight = true;
    session.info.running = true;
    session.info.mode = input.mode ?? session.info.mode;
    session.info.updatedAt = Date.now();
    session.abortController = new AbortController();
    this.persist();
    this.audit('prompt_start', { id, mode: session.info.mode, messageLength: input.message.length });

    void this.runPrompt(session, input.message, session.abortController.signal);
    return { accepted: true };
  }

  cancel(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.abortController?.abort();
    session.host.cancel();
    this.audit('session_cancel', { id });
    return true;
  }

  respondToPermission(id: string, approvalId: string, decision: MitiiApprovalDecision): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    const ok = session.host.resolveApproval(approvalId, decision);
    this.audit('permission_response', { id, approvalId, decision, ok });
    return ok;
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.abortController?.abort();
    void session.host.dispose();
    session.info.closed = true;
    session.info.running = false;
    this.sessions.delete(id);
    this.options.sseHub.clear(id);
    this.persist();
    this.audit('session_close', { id });
    return true;
  }

  async dispose(): Promise<void> {
    for (const id of [...this.sessions.keys()]) {
      this.close(id);
    }
  }

  loadPersistedMetadata(): DaemonSessionInfo[] {
    if (!existsSync(this.registryPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as DaemonSessionInfo[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async runPrompt(session: ManagedSession, prompt: string, signal: AbortSignal): Promise<void> {
    try {
      const mode = session.info.mode;
      if (mode === 'ask') {
        const content = await session.host.ask(prompt);
        this.options.sseHub.publish(session.info.id, { type: 'assistant_delta', content });
        this.options.sseHub.publish(session.info.id, { type: 'done', content });
      } else if (mode === 'plan') {
        const plan = await session.host.plan(prompt);
        this.options.sseHub.publish(session.info.id, { type: 'plan', plan });
        this.options.sseHub.publish(session.info.id, { type: 'done', content: JSON.stringify(plan) });
      } else {
        for await (const event of session.host.agent(prompt, signal)) {
          this.options.sseHub.publish(session.info.id, event);
        }
      }
      this.audit('prompt_done', { id: session.info.id });
    } catch (error) {
      const message = signal.aborted ? 'Prompt cancelled' : error instanceof Error ? error.message : String(error);
      this.options.sseHub.publish(session.info.id, { type: 'error', message });
      this.audit('prompt_error', { id: session.info.id, message });
    } finally {
      session.promptInFlight = false;
      session.info.running = false;
      session.info.updatedAt = Date.now();
      this.persist();
    }
  }

  private persist(): void {
    writeFileSync(this.registryPath, `${JSON.stringify(this.list(), null, 2)}\n`, 'utf-8');
  }

  private audit(type: string, data: Record<string, unknown>): void {
    mkdirSync(dirname(this.auditPath), { recursive: true });
    appendFileSync(this.auditPath, `${JSON.stringify({ at: Date.now(), type, data })}\n`);
  }
}

export class SessionNotFoundError extends Error {}
export class SessionLimitError extends Error {}
export class SessionConflictError extends Error {}
