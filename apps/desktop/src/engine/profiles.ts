/**
 * Provider profiles — global in Desktop SQLite when MITII_DESKTOP_STORE_PATH
 * is set; otherwise legacy `<workspace>/.mitii/profiles.json`.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openDesktopStore } from './desktop-store.js';

export interface DesktopProfileProvider {
  type: string;
  preset?: string;
  baseUrl: string;
  model: string;
  contextWindow: number;
  maximumOutputTokens: number;
}

export interface DesktopProfile {
  id: string;
  name: string;
  provider: DesktopProfileProvider;
  hasSecret: boolean;
  secretHash?: string;
  updatedAt: string;
}

export interface DesktopProfilesFile {
  activeProfileId: string;
  profiles: DesktopProfile[];
}

const DEFAULT_ID = 'default';

function profilesPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', 'profiles.json');
}

function storePathFromEnv(): string | undefined {
  const path = process.env.MITII_DESKTOP_STORE_PATH?.trim();
  return path || undefined;
}

export function hashSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return createHash('sha256').update(trimmed).digest('hex');
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || DEFAULT_ID
  );
}

export function uniqueProfileId(
  name: string,
  existing: readonly DesktopProfile[],
): string {
  const base = slugify(name);
  const ids = new Set(existing.map((p) => p.id));
  if (!ids.has(base) && base !== DEFAULT_ID) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function uniqueId(name: string, existing: readonly DesktopProfile[]): string {
  return uniqueProfileId(name, existing);
}

export function profileFromProvider(
  provider: DesktopProfileProvider,
  options: {
    id?: string;
    name?: string;
    hasSecret?: boolean;
    secretHash?: string;
  } = {},
): DesktopProfile {
  return {
    id: options.id ?? DEFAULT_ID,
    name: options.name?.trim() || 'Default',
    provider: {
      type: provider.type,
      preset: provider.preset ?? provider.type,
      baseUrl: provider.baseUrl,
      model: provider.model,
      contextWindow: Math.max(0, Math.floor(provider.contextWindow || 0)),
      maximumOutputTokens: Math.max(
        0,
        Math.floor(provider.maximumOutputTokens || 0),
      ),
    },
    hasSecret: Boolean(options.hasSecret),
    ...(options.secretHash ? { secretHash: options.secretHash } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProfile(
  raw: unknown,
  fallback: DesktopProfileProvider,
): DesktopProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const provider =
    obj.provider && typeof obj.provider === 'object'
      ? (obj.provider as Record<string, unknown>)
      : {};
  const name = String(obj.name ?? '').trim();
  const id = String(obj.id ?? slugify(name)).trim();
  if (!id || !name) return undefined;
  const num = (value: unknown, fb: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fb;
  };
  return {
    id,
    name,
    provider: {
      type: String(provider.type ?? fallback.type),
      preset:
        typeof provider.preset === 'string' ? provider.preset : fallback.preset,
      baseUrl: String(provider.baseUrl ?? fallback.baseUrl ?? ''),
      model: String(provider.model ?? fallback.model ?? ''),
      contextWindow: num(provider.contextWindow, fallback.contextWindow || 0),
      maximumOutputTokens: num(
        provider.maximumOutputTokens,
        fallback.maximumOutputTokens || 0,
      ),
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
  workspaceRoot: string,
  fallback: DesktopProfileProvider,
  options: { hasSecret?: boolean; secretHash?: string } = {},
): DesktopProfilesFile {
  const fallbackProfile = profileFromProvider(fallback, {
    id: DEFAULT_ID,
    name: 'Default',
    hasSecret: options.hasSecret,
    secretHash: options.secretHash,
  });

  const dbPath = storePathFromEnv();
  if (dbPath) {
    const store = openDesktopStore(dbPath);
    try {
      const file = store.getProfiles();
      if (file.profiles.length > 0) return file;
      store.setProfiles({
        activeProfileId: fallbackProfile.id,
        profiles: [fallbackProfile],
      });
      return {
        activeProfileId: fallbackProfile.id,
        profiles: [fallbackProfile],
      };
    } finally {
      store.close();
    }
  }

  const path = profilesPath(workspaceRoot);
  if (!existsSync(path)) {
    return { activeProfileId: fallbackProfile.id, profiles: [fallbackProfile] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      unknown
    >;
    const profiles = Array.isArray(raw.profiles)
      ? raw.profiles
          .map((entry) => normalizeProfile(entry, fallback))
          .filter((entry): entry is DesktopProfile => Boolean(entry))
      : [];
    if (profiles.length === 0) profiles.push(fallbackProfile);
    const activeRaw =
      typeof raw.activeProfileId === 'string' ? raw.activeProfileId : '';
    const activeProfileId = profiles.some((p) => p.id === activeRaw)
      ? activeRaw
      : profiles[0]!.id;
    return { activeProfileId, profiles };
  } catch {
    return { activeProfileId: fallbackProfile.id, profiles: [fallbackProfile] };
  }
}

export function writeProfiles(
  workspaceRoot: string,
  file: DesktopProfilesFile,
): void {
  const dbPath = storePathFromEnv();
  if (dbPath) {
    const store = openDesktopStore(dbPath);
    try {
      store.setProfiles(file);
    } finally {
      store.close();
    }
    return;
  }

  const dir = join(workspaceRoot, '.mitii');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    profilesPath(workspaceRoot),
    `${JSON.stringify(file, null, 2)}\n`,
    'utf8',
  );
}

export function upsertProfile(
  file: DesktopProfilesFile,
  profile: DesktopProfile,
): DesktopProfilesFile {
  const existing = file.profiles.find((p) => p.id === profile.id);
  const id =
    existing || file.profiles.every((p) => p.id !== profile.id)
      ? profile.id
      : uniqueId(profile.name, file.profiles);
  const next = { ...profile, id, updatedAt: new Date().toISOString() };
  const profiles = existing
    ? file.profiles.map((p) => (p.id === profile.id ? next : p))
    : [...file.profiles, next];
  return { activeProfileId: id, profiles };
}

export function activateProfile(
  file: DesktopProfilesFile,
  profileId: string,
): DesktopProfilesFile | undefined {
  if (!file.profiles.some((p) => p.id === profileId)) return undefined;
  return { ...file, activeProfileId: profileId };
}

export function deleteProfile(
  file: DesktopProfilesFile,
  profileId: string,
): DesktopProfilesFile | undefined {
  if (file.profiles.length <= 1) return undefined;
  const profiles = file.profiles.filter((p) => p.id !== profileId);
  if (profiles.length === file.profiles.length) return undefined;
  const activeProfileId =
    file.activeProfileId === profileId
      ? profiles[0]!.id
      : file.activeProfileId;
  return { activeProfileId, profiles };
}
