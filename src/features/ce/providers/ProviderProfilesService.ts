import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ProviderSettingsPayload } from '../../../kernel/config/ui/payloads';
import { ensureThunderDir } from '../../../features/ce/indexing/paths';
import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('ProviderProfilesService');

export interface ProviderProfileView {
  id: string;
  name: string;
  providerType: ProviderSettingsPayload['providerType'];
  baseUrl: string;
  model: string;
  apiVersion: string;
  region: string;
  contextWindow: number;
  hasApiKey: boolean;
}

interface ProviderProfileRecord {
  id: string;
  name: string;
  providerType: ProviderSettingsPayload['providerType'];
  baseUrl: string;
  model: string;
  apiVersion: string;
  region: string;
  contextWindow: number;
  apiKeyHash?: string;
}

interface ProviderProfilesFile {
  activeId: string | null;
  profiles: ProviderProfileRecord[];
}

export function hashProviderApiKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

export function providerSecretRef(profileId: string): string {
  return `mitii.provider.${profileId}`;
}

function providersDir(workspace: string): string {
  const dir = join(ensureThunderDir(workspace), 'providers');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function indexPath(workspace: string): string {
  return join(providersDir(workspace), 'index.json');
}

function readProfilesFile(workspace: string): ProviderProfilesFile {
  const file = indexPath(workspace);
  if (!existsSync(file)) {
    return { activeId: null, profiles: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as ProviderProfilesFile;
    return {
      activeId: parsed.activeId ?? null,
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch (error) {
    log.warn('Could not read provider profiles', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { activeId: null, profiles: [] };
  }
}

function writeProfilesFile(workspace: string, data: ProviderProfilesFile): void {
  const file = indexPath(workspace);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function toView(profile: ProviderProfileRecord): ProviderProfileView {
  return {
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiVersion: profile.apiVersion,
    region: profile.region,
    contextWindow: profile.contextWindow,
    hasApiKey: Boolean(profile.apiKeyHash),
  };
}

export class ProviderProfilesService {
  constructor(private readonly workspace: string) {}

  list(): ProviderProfileView[] {
    if (!this.workspace) return [];
    return readProfilesFile(this.workspace).profiles.map(toView);
  }

  getActiveId(): string | null {
    if (!this.workspace) return null;
    return readProfilesFile(this.workspace).activeId;
  }

  getActive(): ProviderProfileView | null {
    if (!this.workspace) return null;
    const file = readProfilesFile(this.workspace);
    const active = file.profiles.find((profile) => profile.id === file.activeId);
    return active ? toView(active) : null;
  }

  getById(id: string): ProviderProfileView | null {
    if (!this.workspace) return null;
    const profile = readProfilesFile(this.workspace).profiles.find((item) => item.id === id);
    return profile ? toView(profile) : null;
  }

  upsert(
    settings: ProviderSettingsPayload,
    options: { id?: string; name?: string; apiKey?: string }
  ): ProviderProfileView {
    if (!this.workspace.trim()) {
      throw new Error('Open a workspace to save provider profiles under .mitii/providers.');
    }

    const file = readProfilesFile(this.workspace);
    const id = options.id ?? randomUUID();
    const existing = file.profiles.find((profile) => profile.id === id);
    const name =
      options.name?.trim() ||
      existing?.name ||
      `${settings.providerType} / ${settings.model}`.slice(0, 64);

    const next: ProviderProfileRecord = {
      id,
      name,
      providerType: settings.providerType,
      baseUrl: settings.baseUrl.trim(),
      model: settings.model.trim(),
      apiVersion: settings.apiVersion?.trim() ?? '',
      region: settings.region?.trim() ?? '',
      contextWindow: settings.contextWindow,
      apiKeyHash:
        options.apiKey?.trim()
          ? hashProviderApiKey(options.apiKey)
          : existing?.apiKeyHash,
    };

    const profiles = existing
      ? file.profiles.map((profile) => (profile.id === id ? next : profile))
      : [...file.profiles, next];

    writeProfilesFile(this.workspace, {
      activeId: file.activeId ?? id,
      profiles,
    });

    return toView(next);
  }

  setActive(id: string): ProviderProfileView | null {
    if (!this.workspace.trim()) return null;
    const file = readProfilesFile(this.workspace);
    const profile = file.profiles.find((item) => item.id === id);
    if (!profile) return null;
    writeProfilesFile(this.workspace, { ...file, activeId: id });
    return toView(profile);
  }

  delete(id: string): void {
    if (!this.workspace.trim()) return;
    const file = readProfilesFile(this.workspace);
    const profiles = file.profiles.filter((profile) => profile.id !== id);
    const activeId = file.activeId === id ? profiles[0]?.id ?? null : file.activeId;
    writeProfilesFile(this.workspace, { activeId, profiles });
  }
}
