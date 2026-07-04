export type {
  MitiiApprovalDecision,
  MitiiApprovalMode,
  MitiiClientOptions,
  MitiiEvent,
  MitiiMode,
  MitiiQueryOptions,
  MitiiResult,
  MitiiRuntime,
} from './types';

import type { MitiiApprovalDecision, MitiiClientOptions, MitiiEvent, MitiiQueryOptions, MitiiResult } from './types';

export declare class MitiiClient {
  constructor(options: MitiiClientOptions);
  initialize(): Promise<void>;
  ask(prompt: string): Promise<string>;
  plan(prompt: string): Promise<Record<string, unknown>>;
  agent(prompt: string, signal?: AbortSignal): AsyncIterable<MitiiEvent>;
  query(options: Omit<MitiiQueryOptions, keyof MitiiClientOptions | 'prompt'> & { prompt: string }): AsyncIterable<MitiiEvent>;
  run(options: Omit<MitiiQueryOptions, keyof MitiiClientOptions | 'prompt'> & { prompt: string }): Promise<MitiiResult>;
  resolveApproval(id: string, decision: MitiiApprovalDecision): boolean;
  dispose(): void;
}

export declare function createClient(options: MitiiClientOptions): MitiiClient;
export declare function query(options: MitiiQueryOptions): AsyncIterable<MitiiEvent>;
export declare function isMitiiEvent(value: unknown): value is MitiiEvent;
export declare function isTerminalEvent(event: MitiiEvent): boolean;
