import type * as vscode from 'vscode';

import type { ContextToggles } from './protocol.js';

/**
 * Lean product defaults: keep diagnostics/editor/memory; leave fat sticky
 * blocks (repo map + git diff) off unless the user enables them or intent-lite
 * auto-enables for deep / CI-git-impact asks.
 */
export const DEFAULT_CONTEXT_TOGGLES: ContextToggles = {
  repoMap: false,
  diagnostics: true,
  gitDiff: false,
  editor: true,
  openTabs: false,
  memory: true,
};

const IMPACT_OR_CI_OR_GIT =
  /\b(?:ci(?:\/cd|cd)?|github\s*actions?|workflow|pull\s*request|\bprs?\b|git\s+diff|merge\s+conflict|coverage|regress(?:ion)?s?|commit\s+message)\b/i;

export function isImpactOrCiOrGitPrompt(prompt: string): boolean {
  return IMPACT_OR_CI_OR_GIT.test(prompt);
}

/**
 * Intent-lite host context: preserve explicit user toggles, and auto-enable
 * repoMap/gitDiff for deep asks or CI/git/impact prompts.
 */
export function resolveIntentLiteContextToggles(options: {
  toggles: ContextToggles;
  depth?: string;
  prompt: string;
}): ContextToggles {
  const deep = options.depth === 'deep';
  const impact = isImpactOrCiOrGitPrompt(options.prompt);
  return {
    ...options.toggles,
    repoMap: options.toggles.repoMap || deep || impact,
    gitDiff: options.toggles.gitDiff || deep || impact,
  };
}

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
