/**
 * Mitii Desktop ownership store (SQLite).
 *
 * Global: connected workspaces, provider profiles, active workspace.
 * Per-workspace: full DesktopSettings blob.
 *
 * Lives at `<userData>/mitii-desktop.sqlite` — not inside the repo.
 * Accessed from the engine Node process (and via CLI from Electron main).
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  mergeDesktopSettings,
  type DesktopSettings,
} from '../shared/settings.js';
import {
  workspaceIdFromRoot,
  workspaceLabelFromRoot,
} from './workspace-id.js';
import type { DesktopProfile, DesktopProfilesFile } from './profiles.js';
import { profileFromProvider } from './profiles.js';

export interface DesktopWorkspaceRow {
  path: string;
  workspaceId: string;
  lastOpenedAt: string;
  label: string | null;
  indexFileCount: number | null;
  indexUpdatedAt: string | null;
}

export interface DesktopStoreSnapshot {
  activeWorkspace: string;
  workspaces: DesktopWorkspaceRow[];
  profiles: DesktopProfilesFile;
  settings: DesktopSettings;
}

const DEFAULT_PROFILE = profileFromProvider(
  {
    type: 'openai-compatible',
    preset: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: '',
    contextWindow: 0,
    maximumOutputTokens: 0,
  },
  { id: 'default', name: 'Default' },
);

export function desktopStorePath(userDataPath: string): string {
  return join(userDataPath, 'mitii-desktop.sqlite');
}

export class DesktopStore {
  readonly dbPath: string;
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        path TEXT PRIMARY KEY NOT NULL,
        last_opened_at TEXT NOT NULL,
        label TEXT,
        workspace_id TEXT,
        index_file_count INTEGER,
        index_updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        provider_json TEXT NOT NULL,
        has_secret INTEGER NOT NULL DEFAULT 0,
        secret_hash TEXT,
        updated_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS workspace_settings (
        workspace_path TEXT PRIMARY KEY NOT NULL,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureWorkspaceColumns();
    this.backfillWorkspaceIds();
  }

  private ensureWorkspaceColumns(): void {
    const cols = (
      this.db.prepare(`PRAGMA table_info(workspaces)`).all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    const add = (name: string, ddl: string) => {
      if (!cols.includes(name)) {
        this.db.exec(`ALTER TABLE workspaces ADD COLUMN ${ddl}`);
      }
    };
    add('workspace_id', 'workspace_id TEXT');
    add('index_file_count', 'index_file_count INTEGER');
    add('index_updated_at', 'index_updated_at TEXT');
  }

  private backfillWorkspaceIds(): void {
    const rows = this.db
      .prepare(
        `SELECT path FROM workspaces
         WHERE workspace_id IS NULL OR workspace_id = ''`,
      )
      .all() as Array<{ path: string }>;
    const update = this.db.prepare(
      `UPDATE workspaces SET workspace_id = ?, label = COALESCE(label, ?) WHERE path = ?`,
    );
    for (const row of rows) {
      update.run(
        workspaceIdFromRoot(row.path),
        workspaceLabelFromRoot(row.path),
        row.path,
      );
    }
  }

  getMeta(key: string): string | undefined {
    const row = this.db
      .prepare(`SELECT value FROM app_meta WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  getActiveWorkspace(fallback = ''): string {
    return this.getMeta('active_workspace')?.trim() || fallback;
  }

  setActiveWorkspace(path: string): void {
    const trimmed = path.trim();
    this.setMeta('active_workspace', trimmed);
    if (trimmed) this.touchWorkspace(trimmed);
  }

  listWorkspaces(): DesktopWorkspaceRow[] {
    const rows = this.db
      .prepare(
        `SELECT path,
                workspace_id AS workspaceId,
                last_opened_at AS lastOpenedAt,
                label,
                index_file_count AS indexFileCount,
                index_updated_at AS indexUpdatedAt
         FROM workspaces
         ORDER BY last_opened_at DESC`,
      )
      .all() as Array<{
      path: string;
      workspaceId: string | null;
      lastOpenedAt: string;
      label: string | null;
      indexFileCount: number | null;
      indexUpdatedAt: string | null;
    }>;
    return rows.map((row) => ({
      path: row.path,
      workspaceId: row.workspaceId || workspaceIdFromRoot(row.path),
      lastOpenedAt: row.lastOpenedAt,
      label: row.label || workspaceLabelFromRoot(row.path),
      indexFileCount: row.indexFileCount,
      indexUpdatedAt: row.indexUpdatedAt,
    }));
  }

  getWorkspaceId(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) return workspaceIdFromRoot('.');
    const row = this.db
      .prepare(`SELECT workspace_id AS workspaceId FROM workspaces WHERE path = ?`)
      .get(trimmed) as { workspaceId: string | null } | undefined;
    if (row?.workspaceId) return row.workspaceId;
    const id = workspaceIdFromRoot(trimmed);
    this.touchWorkspace(trimmed);
    return id;
  }

  touchWorkspace(path: string, label?: string): void {
    const trimmed = path.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const id = workspaceIdFromRoot(trimmed);
    const resolvedLabel = label?.trim() || workspaceLabelFromRoot(trimmed);
    this.db
      .prepare(
        `INSERT INTO workspaces
           (path, last_opened_at, label, workspace_id, index_file_count, index_updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(path) DO UPDATE SET
           last_opened_at = excluded.last_opened_at,
           label = COALESCE(excluded.label, workspaces.label),
           workspace_id = COALESCE(workspaces.workspace_id, excluded.workspace_id)`,
      )
      .run(trimmed, now, resolvedLabel, id);
  }

  setWorkspaceIndexMeta(
    path: string,
    meta: { fileCount: number; updatedAt?: string },
  ): void {
    const trimmed = path.trim();
    if (!trimmed) return;
    this.touchWorkspace(trimmed);
    this.db
      .prepare(
        `UPDATE workspaces
         SET index_file_count = ?, index_updated_at = ?
         WHERE path = ?`,
      )
      .run(
        Math.max(0, Math.floor(meta.fileCount)),
        meta.updatedAt ?? new Date().toISOString(),
        trimmed,
      );
  }

  removeWorkspace(path: string): void {
    const trimmed = path.trim();
    this.db.prepare(`DELETE FROM workspaces WHERE path = ?`).run(trimmed);
    this.db
      .prepare(`DELETE FROM workspace_settings WHERE workspace_path = ?`)
      .run(trimmed);
    if (this.getActiveWorkspace() === trimmed) {
      const next = this.listWorkspaces()[0]?.path ?? '';
      this.setMeta('active_workspace', next);
    }
  }

  getWorkspaceSettings(workspacePath: string): DesktopSettings | null {
    const row = this.db
      .prepare(
        `SELECT settings_json AS settingsJson
         FROM workspace_settings WHERE workspace_path = ?`,
      )
      .get(workspacePath.trim()) as { settingsJson: string } | undefined;
    if (!row?.settingsJson) return null;
    try {
      return mergeDesktopSettings(JSON.parse(row.settingsJson));
    } catch {
      return null;
    }
  }

  setWorkspaceSettings(
    workspacePath: string,
    settings: DesktopSettings,
  ): void {
    const trimmed = workspacePath.trim();
    if (!trimmed) throw new Error('workspace_required');
    const sanitized = structuredClone(settings) as Record<string, unknown>;
    delete sanitized.apiKey;
    delete sanitized.api_key;
    this.touchWorkspace(trimmed);
    this.db
      .prepare(
        `INSERT INTO workspace_settings (workspace_path, settings_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_path) DO UPDATE SET
           settings_json = excluded.settings_json,
           updated_at = excluded.updated_at`,
      )
      .run(trimmed, JSON.stringify(sanitized), new Date().toISOString());
  }

  getProfiles(): DesktopProfilesFile {
    const rows = this.db
      .prepare(
        `SELECT id, name, provider_json AS providerJson, has_secret AS hasSecret,
                secret_hash AS secretHash, updated_at AS updatedAt, is_active AS isActive
         FROM profiles ORDER BY name COLLATE NOCASE`,
      )
      .all() as Array<{
      id: string;
      name: string;
      providerJson: string;
      hasSecret: number;
      secretHash: string | null;
      updatedAt: string;
      isActive: number;
    }>;

    if (rows.length === 0) {
      this.setProfiles({
        activeProfileId: DEFAULT_PROFILE.id,
        profiles: [DEFAULT_PROFILE],
      });
      return {
        activeProfileId: DEFAULT_PROFILE.id,
        profiles: [DEFAULT_PROFILE],
      };
    }

    const profiles: DesktopProfile[] = rows.map((row) => {
      let provider = DEFAULT_PROFILE.provider;
      try {
        provider = JSON.parse(row.providerJson) as DesktopProfile['provider'];
      } catch {
        /* keep default */
      }
      return {
        id: row.id,
        name: row.name,
        provider,
        hasSecret: Boolean(row.hasSecret),
        ...(row.secretHash ? { secretHash: row.secretHash } : {}),
        updatedAt: row.updatedAt,
      };
    });

    const active =
      rows.find((r) => r.isActive)?.id ??
      profiles[0]?.id ??
      DEFAULT_PROFILE.id;

    return { activeProfileId: active, profiles };
  }

  setProfiles(file: DesktopProfilesFile): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM profiles`).run();
      const insert = this.db.prepare(
        `INSERT INTO profiles
          (id, name, provider_json, has_secret, secret_hash, updated_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const profile of file.profiles) {
        insert.run(
          profile.id,
          profile.name,
          JSON.stringify(profile.provider),
          profile.hasSecret ? 1 : 0,
          profile.secretHash ?? null,
          profile.updatedAt || new Date().toISOString(),
          profile.id === file.activeProfileId ? 1 : 0,
        );
      }
    });
    tx();
  }

  /**
   * One-time import from legacy JSON files into SQLite.
   * Safe to call repeatedly — only fills empty slots.
   */
  migrateLegacy(options: {
    userDataPath: string;
    workspaceRoot?: string;
    fallbackSettings?: DesktopSettings;
  }): void {
    const statePath = join(options.userDataPath, 'desktop-state.json');
    let legacyWorkspace = options.workspaceRoot?.trim() || '';
    let legacyRecents: string[] = [];
    let legacySettings: DesktopSettings | undefined;

    if (existsSync(statePath)) {
      try {
        const raw = JSON.parse(readFileSync(statePath, 'utf8')) as Record<
          string,
          unknown
        >;
        if (typeof raw.workspaceRoot === 'string' && raw.workspaceRoot.trim()) {
          legacyWorkspace = raw.workspaceRoot.trim();
        }
        if (Array.isArray(raw.recentWorkspaces)) {
          legacyRecents = raw.recentWorkspaces.filter(
            (x): x is string => typeof x === 'string' && x.trim().length > 0,
          );
        }
        if (raw.settings && typeof raw.settings === 'object') {
          legacySettings = mergeDesktopSettings(raw.settings);
        }
      } catch {
        /* ignore */
      }
    }

    if (!this.getActiveWorkspace() && legacyWorkspace) {
      this.setActiveWorkspace(legacyWorkspace);
    }

    for (const path of [legacyWorkspace, ...legacyRecents]) {
      if (path) this.touchWorkspace(path);
    }

    const active = this.getActiveWorkspace(legacyWorkspace);
    if (active && !this.getWorkspaceSettings(active)) {
      const fromDisk = loadLegacyWorkspaceSettingsJson(active);
      const settings =
        fromDisk ?? legacySettings ?? options.fallbackSettings ?? null;
      if (settings) this.setWorkspaceSettings(active, settings);
    }

    const profileCount = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM profiles`).get() as {
        c: number;
      }
    ).c;
    if (profileCount === 0) {
      const fromGlobal = loadLegacyProfilesJson(
        join(options.userDataPath, 'profiles.json'),
      );
      const fromWorkspace = active
        ? loadLegacyProfilesJson(join(active, '.mitii', 'profiles.json'))
        : undefined;
      const file = fromGlobal ?? fromWorkspace;
      if (file) this.setProfiles(file);
    }
  }

  snapshot(fallbackWorkspace = ''): DesktopStoreSnapshot {
    const activeWorkspace = this.getActiveWorkspace(fallbackWorkspace);
    const stored = activeWorkspace
      ? this.getWorkspaceSettings(activeWorkspace)
      : null;
    return {
      activeWorkspace,
      workspaces: this.listWorkspaces(),
      profiles: this.getProfiles(),
      settings: stored ?? mergeDesktopSettings(undefined),
    };
  }
}

function loadLegacyWorkspaceSettingsJson(
  workspaceRoot: string,
): DesktopSettings | undefined {
  const path = join(workspaceRoot, '.mitii', 'desktop-settings.json');
  if (!existsSync(path)) return undefined;
  try {
    return mergeDesktopSettings(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function loadLegacyProfilesJson(
  path: string,
): DesktopProfilesFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      activeProfileId?: string;
      profiles?: DesktopProfile[];
    };
    if (!Array.isArray(raw.profiles) || raw.profiles.length === 0) {
      return undefined;
    }
    const activeProfileId =
      typeof raw.activeProfileId === 'string' &&
      raw.profiles.some((p) => p.id === raw.activeProfileId)
        ? raw.activeProfileId
        : raw.profiles[0]!.id;
    return { activeProfileId, profiles: raw.profiles };
  } catch {
    return undefined;
  }
}

/** Open store at userData (or explicit path). */
export function openDesktopStore(userDataOrDbPath: string): DesktopStore {
  const dbPath = userDataOrDbPath.endsWith('.sqlite')
    ? userDataOrDbPath
    : desktopStorePath(userDataOrDbPath);
  return new DesktopStore(dbPath);
}
