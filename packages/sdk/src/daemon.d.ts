import type { MitiiApprovalDecision, MitiiApprovalMode, MitiiEvent, MitiiMode, MitiiRuntime } from './types';

export interface DaemonClientOptions {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface DaemonSessionCreateOptions {
  cwd: string;
  mode?: MitiiMode;
  approval?: MitiiApprovalMode;
  providerType?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  runtime?: MitiiRuntime;
  indexWorkspace?: boolean;
}

export interface DaemonSessionInfo {
  id: string;
  cwd: string;
  mode: MitiiMode;
  approval: MitiiApprovalMode;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  closed: boolean;
}

export interface DaemonPromptInput {
  mode?: MitiiMode;
  message: string;
  attachments?: unknown[];
}

export interface ParsedSseEvent<T> {
  id: number;
  event?: string;
  data: T;
}

export declare class DaemonClient {
  readonly baseUrl: string;
  constructor(options?: DaemonClientOptions);
  health(): Promise<Record<string, unknown>>;
  capabilities(): Promise<Record<string, unknown>>;
  createSession(options: DaemonSessionCreateOptions): Promise<DaemonSessionInfo>;
  listSessions(): Promise<DaemonSessionInfo[]>;
  getSession(id: string): Promise<DaemonSessionInfo>;
  closeSession(id: string): Promise<Record<string, unknown>>;
  prompt(id: string, input: DaemonPromptInput): Promise<Record<string, unknown>>;
  cancel(id: string): Promise<Record<string, unknown>>;
  respondToPermission(id: string, approvalId: string, decision: MitiiApprovalDecision): Promise<Record<string, unknown>>;
  events(id: string, lastSeenEventId?: number): AsyncIterable<ParsedSseEvent<MitiiEvent>>;
}

export declare class DaemonSessionClient {
  readonly client: DaemonClient;
  readonly session: DaemonSessionInfo;
  lastSeenEventId: number;
  constructor(client: DaemonClient, session: DaemonSessionInfo);
  static createOrAttach(client: DaemonClient, options: DaemonSessionCreateOptions): Promise<DaemonSessionClient>;
  prompt(input: DaemonPromptInput): Promise<Record<string, unknown>>;
  cancel(): Promise<Record<string, unknown>>;
  respondToPermission(id: string, decision: MitiiApprovalDecision): Promise<Record<string, unknown>>;
  events(): AsyncIterable<MitiiEvent>;
}

export declare function parseSseStream<T>(responsePromise: Promise<Response>): AsyncIterable<ParsedSseEvent<T>>;
