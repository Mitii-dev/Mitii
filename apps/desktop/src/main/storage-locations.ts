/**
 * Resolves / relocates Mitii Desktop storage roots (Electron main).
 *
 * Contract: shared/storage-layout.ts
 * - App data: Electron userData
 * - Root storage: parent for all project artifacts
 * - Project: {root}/projects/{slug}--{id}/ linked as <repo>/.mitii
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { app } from 'electron';

import {
  ROOT_PROJECTS_DIR,
  STORAGE_META_ROOT_KEY,
  defaultRootStoragePath,
  resolveWorkspaceStorage,
  workspaceLinkPath,
  type StorageLayout,
  type WorkspaceStorageLayout,
} from '../shared/storage-layout.js';
import { workspaceIdFromRoot } from '../engine/workspace-id.js';

const APP_DATA_REDIRECT_FILE = 'desktop-data-location.json';
const ROOT_STORAGE_FILE = 'desktop-storage-root.json';

export interface DesktopStorageInfo {
  appDataPath: string;
  appDataDefaultPath: string;
  appDataCustom: boolean;
  rootStoragePath: string;
  rootStorageCustom: boolean;
  rootStorageDefaultPath: string;
  workspaceDataPath: string;
  workspaceDataTarget: string;
  workspaceDataIsLink: boolean;
  projectFolderName: string;
  projectSlug: string;
  usesRootStorage: boolean;
  logsPath: string;
  workspaceId: string;
  restartRequiredForAppData: boolean;
}

function mitiiOrgDir(): string {
  return join(app.getPath('appData'), '@mitii');
}

export function appDataRedirectPath(): string {
  return join(mitiiOrgDir(), APP_DATA_REDIRECT_FILE);
}

export function rootStorageConfigPath(): string {
  return join(mitiiOrgDir(), ROOT_STORAGE_FILE);
}

export function defaultUserDataPath(): string {
  return join(mitiiOrgDir(), 'desktop');
}

/** Call before `app.ready`. */
export function applyAppDataRedirectBeforeReady(): string | undefined {
  try {
    const path = appDataRedirectPath();
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      userDataPath?: unknown;
    };
    if (typeof raw.userDataPath !== 'string' || !raw.userDataPath.trim()) {
      return undefined;
    }
    const next = resolve(raw.userDataPath.trim());
    mkdirSync(next, { recursive: true });
    app.setPath('userData', next);
    return next;
  } catch {
    return undefined;
  }
}

export function readAppDataRedirect(): string | undefined {
  try {
    const path = appDataRedirectPath();
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      userDataPath?: unknown;
    };
    if (typeof raw.userDataPath !== 'string' || !raw.userDataPath.trim()) {
      return undefined;
    }
    return resolve(raw.userDataPath.trim());
  } catch {
    return undefined;
  }
}

export function writeAppDataRedirect(userDataPath: string | null): void {
  mkdirSync(mitiiOrgDir(), { recursive: true });
  const path = appDataRedirectPath();
  if (!userDataPath || !userDataPath.trim()) {
    if (existsSync(path)) rmSync(path, { force: true });
    return;
  }
  const next = resolve(userDataPath.trim());
  mkdirSync(next, { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ userDataPath: next }, null, 2)}\n`,
    'utf8',
  );
}

/** Persistent root storage (survives userData moves; lives under @mitii org dir). */
export function readRootStoragePath(): string | undefined {
  try {
    const path = rootStorageConfigPath();
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      rootStoragePath?: unknown;
    };
    if (typeof raw.rootStoragePath !== 'string' || !raw.rootStoragePath.trim()) {
      return undefined;
    }
    return resolve(raw.rootStoragePath.trim());
  } catch {
    return undefined;
  }
}

export function writeRootStoragePath(rootPath: string | null): void {
  mkdirSync(mitiiOrgDir(), { recursive: true });
  const path = rootStorageConfigPath();
  if (!rootPath || !rootPath.trim()) {
    if (existsSync(path)) rmSync(path, { force: true });
    return;
  }
  const next = resolve(rootPath.trim());
  mkdirSync(join(next, ROOT_PROJECTS_DIR), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ rootStoragePath: next }, null, 2)}\n`,
    'utf8',
  );
}

export function getStorageLayout(): StorageLayout {
  const appDataPath = app.getPath('userData');
  const custom = readRootStoragePath();
  const rootStorageDefaultPath = defaultRootStoragePath(appDataPath);
  return {
    appDataPath,
    rootStoragePath: custom ?? '',
    rootStorageCustom: Boolean(custom),
    rootStorageDefaultPath,
  };
}

export function layoutForWorkspace(
  workspaceRoot: string,
): WorkspaceStorageLayout {
  return resolveWorkspaceStorage({
    workspaceRoot,
    workspaceId: workspaceIdFromRoot(workspaceRoot),
    rootStoragePath: readRootStoragePath() ?? null,
  });
}

function migrateDirectoryContents(from: string, to: string): void {
  if (!existsSync(from) || resolve(from) === resolve(to)) return;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dest = join(to, name);
    if (existsSync(dest)) continue;
    try {
      renameSync(src, dest);
    } catch {
      cpSync(src, dest, { recursive: true });
      rmSync(src, { recursive: true, force: true });
    }
  }
  try {
    rmSync(from, { recursive: true, force: true });
  } catch {
    /* leave empty legacy dir if busy */
  }
}

/**
 * Ensure workspace artifacts live under root storage and `<repo>/.mitii`
 * is a symlink to that folder. No-op link when root storage is unset.
 */
export function ensureWorkspaceStorageLink(
  workspaceRoot: string,
): WorkspaceStorageLayout {
  const layout = layoutForWorkspace(workspaceRoot);
  if (!layout.usesRootStorage) {
    mkdirSync(layout.dataPath, { recursive: true });
    return layout;
  }

  // Migrate legacy `{root}/workspaces/{id}` → `{root}/projects/{slug}--{id}`.
  if (layout.legacyDataPath && existsSync(layout.legacyDataPath)) {
    migrateDirectoryContents(layout.legacyDataPath, layout.dataPath);
  }

  mkdirSync(layout.dataPath, { recursive: true });
  mkdirSync(join(layout.dataPath, 'logs'), { recursive: true });

  const linkPath = layout.linkPath;
  if (existsSync(linkPath)) {
    try {
      const st = lstatSync(linkPath);
      if (st.isSymbolicLink()) {
        const current = resolve(dirname(linkPath), readlinkSync(linkPath));
        if (current === layout.dataPath) return layout;
        rmSync(linkPath, { force: true });
      } else if (st.isDirectory()) {
        migrateDirectoryContents(linkPath, layout.dataPath);
        if (existsSync(linkPath)) {
          rmSync(linkPath, { recursive: true, force: true });
        }
      } else {
        return layout;
      }
    } catch {
      return layout;
    }
  }

  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(layout.dataPath, linkPath, linkType);
  } catch {
    /* best-effort; host may still create local .mitii */
  }
  return layout;
}

export function workspaceMitiiPath(workspaceRoot: string): string {
  return workspaceLinkPath(workspaceRoot);
}

export function resolveWorkspaceDataTarget(workspaceRoot: string): {
  path: string;
  isLink: boolean;
} {
  const layout = layoutForWorkspace(workspaceRoot);
  const linkPath = layout.linkPath;
  if (!existsSync(linkPath)) {
    return { path: layout.dataPath, isLink: false };
  }
  try {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      return {
        path: resolve(dirname(linkPath), readlinkSync(linkPath)),
        isLink: true,
      };
    }
  } catch {
    /* fall through */
  }
  return { path: linkPath, isLink: false };
}

export function getStorageInfo(workspaceRoot: string): DesktopStorageInfo {
  const layout = getStorageLayout();
  const ws = layoutForWorkspace(workspaceRoot || process.cwd());
  const target = resolveWorkspaceDataTarget(workspaceRoot || process.cwd());
  const customApp = readAppDataRedirect();
  return {
    appDataPath: layout.appDataPath,
    appDataDefaultPath: defaultUserDataPath(),
    appDataCustom: Boolean(customApp),
    rootStoragePath: layout.rootStoragePath,
    rootStorageCustom: layout.rootStorageCustom,
    rootStorageDefaultPath: layout.rootStorageDefaultPath,
    workspaceDataPath: ws.linkPath,
    workspaceDataTarget: target.path,
    workspaceDataIsLink: target.isLink,
    projectFolderName: ws.projectFolderName,
    projectSlug: ws.projectSlug,
    usesRootStorage: ws.usesRootStorage,
    logsPath: join(target.path, 'logs'),
    workspaceId: ws.workspaceId,
    restartRequiredForAppData: Boolean(
      customApp && resolve(customApp) !== resolve(layout.appDataPath),
    ),
  };
}

/** Point workspace at an explicit folder (override); still creates .mitii link. */
export function relocateWorkspaceData(
  workspaceRoot: string,
  targetDir: string,
): { ok: true; target: string } | { ok: false; reason: string } {
  const root = resolve(workspaceRoot);
  const target = resolve(targetDir);
  const linkPath = workspaceLinkPath(root);

  if (target === linkPath) {
    return { ok: false, reason: 'target_is_default_mitii' };
  }

  try {
    mkdirSync(target, { recursive: true });
    if (existsSync(linkPath)) {
      const st = lstatSync(linkPath);
      if (st.isSymbolicLink()) {
        const current = resolve(dirname(linkPath), readlinkSync(linkPath));
        if (current === target) return { ok: true, target };
        rmSync(linkPath, { force: true });
      } else if (st.isDirectory()) {
        migrateDirectoryContents(linkPath, target);
        if (existsSync(linkPath)) {
          rmSync(linkPath, { recursive: true, force: true });
        }
      } else {
        return { ok: false, reason: 'mitii_not_directory' };
      }
    }
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(target, linkPath, linkType);
    return { ok: true, target };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resetWorkspaceDataToDefault(
  workspaceRoot: string,
): { ok: true; target?: string } | { ok: false; reason: string } {
  const root = resolve(workspaceRoot);
  const linkPath = workspaceLinkPath(root);
  try {
    const rootStorage = readRootStoragePath();
    if (rootStorage) {
      const layout = ensureWorkspaceStorageLink(root);
      return { ok: true, target: layout.dataPath };
    }

    if (!existsSync(linkPath)) {
      mkdirSync(linkPath, { recursive: true });
      return { ok: true, target: linkPath };
    }
    const st = lstatSync(linkPath);
    if (!st.isSymbolicLink()) return { ok: true, target: linkPath };

    const target = resolve(dirname(linkPath), readlinkSync(linkPath));
    rmSync(linkPath, { force: true });
    mkdirSync(linkPath, { recursive: true });
    if (existsSync(target)) {
      migrateDirectoryContents(target, linkPath);
    }
    return { ok: true, target: linkPath };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export { STORAGE_META_ROOT_KEY };
