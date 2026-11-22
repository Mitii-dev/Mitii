export type WorkspaceSide = 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes';

export type TreeEntry = { name: string; path: string; kind: 'file' | 'dir' };

export interface OpenTab {
  path: string;
  content: string;
  savedContent: string;
  truncated: boolean;
  mode: 'file' | 'diff';
  /** True while the first fetch is in flight (skip FS reload races). */
  loading?: boolean;
  /**
   * Preview tabs (single-click) are replaced by the next preview open.
   * Double-click, edit, or explicit pin clears this.
   */
  preview?: boolean;
}

export type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
};

export type ClipboardState = {
  paths: string[];
  mode: 'copy' | 'cut';
};

export type CreateDraft = {
  parent: string;
  kind: 'file' | 'dir';
  name: string;
};

export type PathMove = { from: string; to: string };

export type FlatRow =
  | { type: 'entry'; entry: TreeEntry; depth: number }
  | { type: 'create'; parent: string; depth: number };

/** HTTP identity shared by explorer hooks. */
export interface ExplorerAuth {
  baseUrl: string;
  token?: string;
}
