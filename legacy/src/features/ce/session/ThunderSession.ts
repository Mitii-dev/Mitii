import { randomUUID } from 'crypto';
import type { ProviderType } from '../../../kernel/config/schema';


export type ThunderMode = 'ask' | 'plan' | 'agent' | 'review';


/** Map legacy persisted values and unknown strings to a valid mode. */
export function normalizeThunderMode(mode: string): ThunderMode {
  if (mode === 'act') return 'agent';
  if (mode === 'ask' || mode === 'plan' || mode === 'agent' || mode === 'review') return mode;
  return 'plan';
}

export function isReadOnlyThunderMode(mode: string): boolean {
  const normalized = normalizeThunderMode(mode);
  return normalized === 'ask' || normalized === 'plan' || normalized === 'review';
}

export interface ThunderSessionState {
  id: string;
  workspace: string;
  mode: ThunderMode;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  providerOverride: ThunderSessionProviderOverride | null;
}

export interface ThunderSessionProviderOverride {
  providerType: ProviderType;
  model: string;
  baseUrl: string;
  profile: string | null;
  profileId?: string;
  apiVersion?: string;
  region?: string;
  contextWindow?: number;
}

export class ThunderSession {
  readonly id: string;
  readonly workspace: string;
  mode: ThunderMode;
  title: string | null;
  readonly createdAt: number;
  updatedAt: number;
  providerOverride: ThunderSessionProviderOverride | null;

  constructor(
    workspace: string,
    mode: ThunderMode = 'plan',
    restored?: {
      id?: string;
      title?: string | null;
      createdAt?: number;
      updatedAt?: number;
      providerOverride?: ThunderSessionProviderOverride | null;
    }
  ) {
    this.id = restored?.id?.trim() || randomUUID();
    this.workspace = workspace;
    this.mode = normalizeThunderMode(mode);
    this.title = restored?.title ?? null;
    this.createdAt = restored?.createdAt ?? Date.now();
    this.updatedAt = restored?.updatedAt ?? this.createdAt;
    this.providerOverride = restored?.providerOverride ?? null;
  }

  touch(): void {
    this.updatedAt = Date.now();
  }

  setMode(mode: ThunderMode): void {
    this.mode = normalizeThunderMode(mode);
    this.touch();
  }

  setProviderOverride(override: ThunderSessionProviderOverride | null): void {
    this.providerOverride = override;
    this.touch();
  }

  toState(): ThunderSessionState {
    return {
      id: this.id,
      workspace: this.workspace,
      mode: this.mode,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      providerOverride: this.providerOverride,
    };
  }
}
