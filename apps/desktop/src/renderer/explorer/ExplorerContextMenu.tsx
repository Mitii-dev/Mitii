import { useEffect } from 'react';

import type { ClipboardState, ContextMenuState, TreeEntry } from './explorerTypes.js';
import { isMacPlatform, revealLabel } from './pathUtils.js';

export interface ExplorerContextMenuProps {
  menu: ContextMenuState;
  entryByPath: Map<string, TreeEntry>;
  clipboard: ClipboardState | null;
  onClose: () => void;
  onBeginCreate: (kind: 'file' | 'dir', paths: string[]) => void;
  onOpenFile: (path: string) => void;
  onClipboard: (paths: string[], mode: 'copy' | 'cut') => void;
  onPaste: (paths: string[]) => void;
  onCopyAbsolutePaths: (paths: string[]) => void;
  onCopyRelativePaths: (paths: string[]) => void;
  onCopyNames: (paths: string[]) => void;
  onReveal: (paths: string[]) => void;
  onRename: (path: string) => void;
  onDelete: (paths: string[]) => void;
}

export function ExplorerContextMenu(props: ExplorerContextMenuProps) {
  const { menu, onClose } = props;

  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('click', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const menuPaths = menu.paths;
  const menuSingle = menuPaths.length === 1 ? menuPaths[0] : null;
  const menuEntry = menuSingle ? props.entryByPath.get(menuSingle) : undefined;
  const mac = isMacPlatform();

  return (
    <div
      className="explorer-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => props.onBeginCreate('file', menuPaths)}
      >
        New File...
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => props.onBeginCreate('dir', menuPaths)}
      >
        New Folder...
      </button>
      <hr />
      {menuSingle && menuEntry?.kind === 'file' ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            props.onOpenFile(menuSingle);
          }}
        >
          Open
        </button>
      ) : null}
      {menuPaths.length > 0 ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onClipboard(menuPaths, 'cut')}
          >
            Cut
            <kbd className="explorer-menu__kbd">{mac ? '⌘X' : 'Ctrl+X'}</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onClipboard(menuPaths, 'copy')}
          >
            Copy
            <kbd className="explorer-menu__kbd">{mac ? '⌘C' : 'Ctrl+C'}</kbd>
          </button>
        </>
      ) : null}
      <button
        type="button"
        role="menuitem"
        disabled={!props.clipboard}
        onClick={() => props.onPaste(menuPaths)}
      >
        Paste
        <kbd className="explorer-menu__kbd">{mac ? '⌘V' : 'Ctrl+V'}</kbd>
      </button>
      <hr />
      {menuPaths.length > 0 ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              props.onCopyAbsolutePaths(menuPaths);
            }}
          >
            Copy Path
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              props.onCopyRelativePaths(menuPaths);
            }}
          >
            Copy Relative Path
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              props.onCopyNames(menuPaths);
            }}
          >
            Copy Name
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onReveal(menuPaths)}
          >
            {revealLabel()}
          </button>
          <hr />
        </>
      ) : null}
      {menuSingle ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => props.onRename(menuSingle)}
        >
          Rename
          <kbd className="explorer-menu__kbd">{mac ? 'Enter' : 'F2'}</kbd>
        </button>
      ) : null}
      {menuPaths.length > 0 ? (
        <button
          type="button"
          role="menuitem"
          className="explorer-menu__danger"
          onClick={() => props.onDelete(menuPaths)}
        >
          Delete
          <kbd className="explorer-menu__kbd">{mac ? '⌘⌫' : 'Del'}</kbd>
        </button>
      ) : null}
    </div>
  );
}
