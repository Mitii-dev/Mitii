export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

export function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Workspace folder name only (VS Code explorer root), not a truncated path. */
export function workspaceFolderName(workspaceRoot: string): string {
  const parts = workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || workspaceRoot || 'Workspace';
}

export function remapUnder(
  oldPath: string,
  newPath: string,
  path: string,
): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  );
}

export function revealLabel(): string {
  if (typeof navigator === 'undefined') return 'Reveal in File Manager';
  if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
    return 'Reveal in Finder';
  }
  if (/Win/i.test(navigator.platform)) return 'Reveal in File Explorer';
  return 'Reveal in File Manager';
}
