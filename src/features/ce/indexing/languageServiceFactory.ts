import type { IgnoreService } from './IgnoreService';
import type { IndexingConfig } from '../../../kernel/config/schema';
import { WorkspaceLanguageService } from './WorkspaceLanguageService';

/** Keyed per-workspace, mirroring RepoMapService's static cache — this is the single place both
 * ThunderController (VS Code host) and HeadlessAgentHost (headless/eval host) obtain a language
 * service instance, so the two independently-managed lifecycles can never diverge. */
const registry = new Map<string, WorkspaceLanguageService>();

export function getOrCreateLanguageService(
  workspace: string,
  ignoreService: IgnoreService,
  config: IndexingConfig
): WorkspaceLanguageService {
  const existing = registry.get(workspace);
  if (existing) return existing;

  const service = new WorkspaceLanguageService(workspace, ignoreService, config);
  registry.set(workspace, service);
  return service;
}

export function disposeLanguageService(workspace: string): void {
  const existing = registry.get(workspace);
  if (!existing) return;
  existing.dispose();
  registry.delete(workspace);
}
