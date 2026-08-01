import type * as vscode from 'vscode';

import type { ContextToggles } from './protocol.js';

export const DEFAULT_CONTEXT_TOGGLES: ContextToggles = {
  repoMap: true,
  diagnostics: true,
  gitDiff: true,
  editor: true,
  openTabs: false,
  memory: true,
};

export function resolveContextToggles(
  config: vscode.WorkspaceConfiguration,
): ContextToggles {
  const toggles = { ...DEFAULT_CONTEXT_TOGGLES };
  for (const key of Object.keys(toggles) as Array<keyof ContextToggles>) {
    toggles[key] =
      config.get<boolean>(`ui.contextToggles.${key}`) ?? toggles[key];
  }
  return toggles;
}

export function readContextToggles(vs: typeof vscode): ContextToggles {
  return resolveContextToggles(vs.workspace.getConfiguration('mitii'));
}
