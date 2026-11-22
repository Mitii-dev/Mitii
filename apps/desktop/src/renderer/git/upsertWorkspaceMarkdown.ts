import { createWorkspaceFilePath, saveWorkspaceFile } from '../api.js';

import type { ScmAuth } from './scmTypes.js';

/** Save an existing workspace file, or create it when the save fails. */
export async function upsertWorkspaceMarkdown(
  auth: ScmAuth,
  relPath: string,
  content: string,
): Promise<void> {
  try {
    await saveWorkspaceFile({ ...auth, path: relPath, content });
  } catch {
    const slash = relPath.lastIndexOf('/');
    const parent = slash >= 0 ? relPath.slice(0, slash) : '';
    const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;
    await createWorkspaceFilePath({
      ...auth,
      parent,
      name,
      content,
    });
  }
}
