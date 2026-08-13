import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProviderSettingsSnapshot, SettingsProfileView } from './protocol.js';

const PROFILES_FILE = 'profiles.json';
const DEFAULT_PROFILE_ID = 'default';

interface ProfilesFile {
  activeProfileId: string;
  profiles: SettingsProfileView[];
}

function profilesPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', PROFILES_FILE);
}

function slugifyProfileId(name: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || DEFAULT_PROFILE_ID;
  return base;
}

function stableProfileId(name: string, existing: readonly SettingsProfileView[]): string {
  const base = slugifyProfileId(name);
  const ids = new Set(existing.map((profile) => profile.id));
  if (!ids.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function hashSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return createHash('sha256').update(trimmed).digest('hex');
}

export function profileFromProvider(
  provider: ProviderSettingsSnapshot,
  options: { id?: string; name?: string; secretHash?: string } = {},
): SettingsProfileView {
  const preset = provider.preset ?? provider.type;
  return {
    id: options.id ?? DEFAULT_PROFILE_ID,
    name: options.name?.trim() || 'Default',
    provider: {
      type: provider.type,
      preset,
      baseUrl: provider.baseUrl,
      model: provider.model,
      contextWindow: provider.contextWindow,
      maximumOutputTokens: provider.maximumOutputTokens,
    },
    hasSecret: provider.hasApiKey,
    secretHash: options.secretHash,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProfile(
  raw: unknown,
  fallback: ProviderSettingsSnapshot,
): SettingsProfileView | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const provider =
    obj.provider && typeof obj.provider === 'object'
      ? (obj.provider as Record<string, unknown>)
      : {};
  const name = String(obj.name ?? '').trim();
  const id = String(obj.id ?? slugifyProfileId(name)).trim();
  if (!id || !name) return undefined;
  return {
    id,
    name,
    provider: {
      type: String(provider.type ?? fallback.type),
      preset:
        typeof provider.preset === 'string' ? provider.preset : fallback.preset,
      baseUrl: String(provider.baseUrl ?? fallback.baseUrl),
      model: String(provider.model ?? fallback.model),
      contextWindow:
        Number(provider.contextWindow) || fallback.contextWindow || 32768,
      maximumOutputTokens:
        Number(provider.maximumOutputTokens) ||
        fallback.maximumOutputTokens ||
        16384,
    },
    hasSecret: Boolean(obj.hasSecret),
    secretHash: typeof obj.secretHash === 'string' ? obj.secretHash : undefined,
    updatedAt:
      typeof obj.updatedAt === 'string'
        ? obj.updatedAt
        : new Date().toISOString(),
  };
}

export function readProfiles(
  workspaceRoot: string | undefined,
  fallbackProvider: ProviderSettingsSnapshot,
  secretHash?: string,
): ProfilesFile {
  const fallbackProfile = profileFromProvider(fallbackProvider, {
    id: DEFAULT_PROFILE_ID,
    name: 'Default',
    secretHash,
  });
  if (!workspaceRoot) {
    return {
      activeProfileId: fallbackProfile.id,
      profiles: [fallbackProfile],
    };
  }
  const path = profilesPath(workspaceRoot);
  if (!existsSync(path)) {
    return {
      activeProfileId: fallbackProfile.id,
      profiles: [fallbackProfile],
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const profiles = Array.isArray(raw.profiles)
      ? raw.profiles
          .map((entry) => normalizeProfile(entry, fallbackProvider))
          .filter((entry): entry is SettingsProfileView => Boolean(entry))
      : [];
    if (profiles.length === 0) profiles.push(fallbackProfile);
    const activeProfileIdRaw =
      typeof raw.activeProfileId === 'string' ? raw.activeProfileId : '';
    const activeProfileId = profiles.some((profile) => profile.id === activeProfileIdRaw)
      ? activeProfileIdRaw
      : profiles[0]!.id;
    return { activeProfileId, profiles };
  } catch {
    return {
      activeProfileId: fallbackProfile.id,
      profiles: [fallbackProfile],
    };
  }
}

export function writeProfiles(
  workspaceRoot: string | undefined,
  profilesFile: ProfilesFile,
): void {
  if (!workspaceRoot) return;
  const dir = join(workspaceRoot, '.mitii');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, PROFILES_FILE),
    `${JSON.stringify(profilesFile, null, 2)}\n`,
    'utf8',
  );
}

export function upsertProfile(
  profilesFile: ProfilesFile,
  profile: SettingsProfileView,
): ProfilesFile {
  const existing = profilesFile.profiles.find((entry) => entry.id === profile.id);
  const ids = new Set(profilesFile.profiles.map((entry) => entry.id));
  const id =
    existing || !ids.has(profile.id)
      ? profile.id
      : stableProfileId(profile.name, profilesFile.profiles);
  const nextProfile = {
    ...profile,
    id,
    updatedAt: new Date().toISOString(),
  };
  const profiles = existing
    ? profilesFile.profiles.map((entry) =>
        entry.id === profile.id ? nextProfile : entry,
      )
    : [...profilesFile.profiles, nextProfile];
  return {
    activeProfileId: id,
    profiles,
  };
}
