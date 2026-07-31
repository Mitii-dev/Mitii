import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, win32 } from 'node:path';

const PREVIEW_DIR = '.mitii/diff-preview';

export interface DiffPreviewFile {
  relPath: string;
  originalPath: string;
  previewPath: string;
}

export interface PatchDiffPreviewFiles {
  relPath: string;
  oldPath: string;
  newPath: string;
}

/**
 * Host-owned preview writer for proposed edits under
 * `<workspace>/.mitii/diff-preview/`.
 *
 * This does not mutate the real workspace file. Apps can use the returned
 * paths for UI diffing, verification overlays, or an explicit apply step.
 */
export class FileDiffPreviewStore {
  private readonly workspaceRoot: string;
  private readonly previewRoot: string;

  constructor(workspaceRoot: string) {
    const trimmed = workspaceRoot.trim();
    if (!trimmed) {
      throw new Error('FileDiffPreviewStore requires a workspace root.');
    }
    this.workspaceRoot = resolve(trimmed);
    this.previewRoot = join(this.workspaceRoot, PREVIEW_DIR);
  }

  public async writeProposedFile(
    relPath: string,
    newContent: string,
  ): Promise<DiffPreviewFile> {
    const normalizedRelPath = normalizeRelativePath(relPath);
    const previewPath = this.previewPathFor(normalizedRelPath);
    await mkdir(this.previewRoot, { recursive: true });
    await writeFile(previewPath, newContent, 'utf8');
    return {
      relPath: normalizedRelPath,
      originalPath: join(this.workspaceRoot, normalizedRelPath),
      previewPath,
    };
  }

  public async writePatchPair(
    relPath: string,
    oldText: string,
    newText: string,
  ): Promise<PatchDiffPreviewFiles> {
    const normalizedRelPath = normalizeRelativePath(relPath);
    const oldPath = join(
      this.previewRoot,
      `old__${flattenPreviewName(normalizedRelPath)}`,
    );
    const newPath = join(
      this.previewRoot,
      `new__${flattenPreviewName(normalizedRelPath)}`,
    );
    await mkdir(this.previewRoot, { recursive: true });
    await Promise.all([
      writeFile(oldPath, oldText, 'utf8'),
      writeFile(newPath, newText, 'utf8'),
    ]);
    return { relPath: normalizedRelPath, oldPath, newPath };
  }

  public async readOriginal(relPath: string): Promise<string | undefined> {
    const normalizedRelPath = normalizeRelativePath(relPath);
    try {
      return await readFile(join(this.workspaceRoot, normalizedRelPath), 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public async clear(): Promise<void> {
    await rm(this.previewRoot, { recursive: true, force: true });
  }

  private previewPathFor(relPath: string): string {
    return join(this.previewRoot, flattenPreviewName(relPath));
  }
}

function normalizeRelativePath(relPath: string): string {
  const trimmed = relPath.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new Error('Preview path must be a non-empty workspace-relative path.');
  }
  if (isAbsolute(trimmed) || win32.isAbsolute(trimmed)) {
    throw new Error(`Preview path must be relative: ${relPath}`);
  }
  const normalized = normalize(trimmed).replace(/\\/g, '/');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`Preview path escapes the workspace: ${relPath}`);
  }
  return normalized;
}

function flattenPreviewName(relPath: string): string {
  return relPath.replace(/[\\/]+/g, '__');
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
