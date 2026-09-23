/**
 * Enterprise storage path contract (pure, host-neutral).
 *
 * Root storage → projects/{slug}--{id}/ → linked as <repo>/.mitii
 *
 * Legacy (still migrated): workspaces/{workspaceId}/
 */

import { basename, join, resolve } from 'node:path';

export const STORAGE_META_ROOT_KEY = 'storage_root';

/** Folder under root that holds per-project artifact dirs. */
export const ROOT_PROJECTS_DIR = 'projects';

/** Legacy folder name (migrated into projects/). */
export const ROOT_WORKSPACES_DIR_LEGACY = 'workspaces';

export interface StorageLayout {
  appDataPath: string;
  rootStoragePath: string;
  rootStorageCustom: boolean;
  rootStorageDefaultPath: string;
}

export interface WorkspaceStorageLayout {
  workspaceRoot: string;
  workspaceId: string;
  projectSlug: string;
  projectFolderName: string;
  dataPath: string;
  /** Previous layout path, if any (for one-shot migrate). */
  legacyDataPath?: string;
  linkPath: string;
  logsPath: string;
  usesRootStorage: boolean;
}

export function defaultRootStoragePath(appDataPath: string): string {
  return join(resolve(appDataPath), 'workspace-storage');
}

export function workspaceLinkPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), '.mitii');
}

/** Safe folder segment from the repo leaf name. */
export function projectSlugFromRoot(workspaceRoot: string): string {
  const raw = basename(resolve(workspaceRoot.trim() || '.')) || 'project';
  const slug = raw
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}

/** Short stable id for folder names (workspaceId without `ws_` prefix). */
export function projectIdSuffix(workspaceId: string): string {
  const id = workspaceId.trim();
  if (id.startsWith('ws_')) return id.slice(3);
  return id.replace(/[^\w]+/g, '').slice(0, 16) || 'unknown';
}

export function projectFolderName(
  projectSlug: string,
  workspaceId: string,
): string {
  return `${projectSlug}--${projectIdSuffix(workspaceId)}`;
}

export function workspaceDataPathUnderRoot(
  rootStoragePath: string,
  workspaceId: string,
  workspaceRoot?: string,
): string {
  const slug = projectSlugFromRoot(workspaceRoot ?? workspaceId);
  const folder = projectFolderName(slug, workspaceId);
  return join(resolve(rootStoragePath), ROOT_PROJECTS_DIR, folder);
}

/** Pre-projects layout: `{root}/workspaces/{workspaceId}`. */
export function legacyWorkspaceDataPathUnderRoot(
  rootStoragePath: string,
  workspaceId: string,
): string {
  return join(resolve(rootStoragePath), ROOT_WORKSPACES_DIR_LEGACY, workspaceId);
}

export function resolveWorkspaceStorage(options: {
  workspaceRoot: string;
  workspaceId: string;
  rootStoragePath?: string | null;
}): WorkspaceStorageLayout {
  const workspaceRoot = resolve(options.workspaceRoot.trim() || '.');
  const linkPath = workspaceLinkPath(workspaceRoot);
  const projectSlug = projectSlugFromRoot(workspaceRoot);
  const folderName = projectFolderName(projectSlug, options.workspaceId);
  const root = options.rootStoragePath?.trim();
  if (root) {
    const dataPath = join(resolve(root), ROOT_PROJECTS_DIR, folderName);
    return {
      workspaceRoot,
      workspaceId: options.workspaceId,
      projectSlug,
      projectFolderName: folderName,
      dataPath,
      legacyDataPath: legacyWorkspaceDataPathUnderRoot(root, options.workspaceId),
      linkPath,
      logsPath: join(dataPath, 'logs'),
      usesRootStorage: true,
    };
  }
  return {
    workspaceRoot,
    workspaceId: options.workspaceId,
    projectSlug,
    projectFolderName: folderName,
    dataPath: linkPath,
    linkPath,
    logsPath: join(linkPath, 'logs'),
    usesRootStorage: false,
  };
}
