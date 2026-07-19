import type { IgnoreService } from '../indexing/IgnoreService';
import type { ThunderDb } from '../indexing/ThunderDb';
import type { FtsIndex } from '../indexing/FtsIndex';
import type { VectorIndexService } from '../indexing/VectorIndex';
import type { WorkspaceLanguageService } from '../indexing/WorkspaceLanguageService';
import type { RepoMapService } from '../context/RepoMapService';
import type { HybridRetriever } from '../context/HybridRetriever';
import type { ContextBudgeter } from '../context/ContextBudgeter';
import type { GitService } from '../context/GitService';
import type { MemoryService } from '../memory/MemoryService';
import type { AutoMemoryFileWriter } from '../memory/AutoMemoryFileWriter';
import type { SkillCatalogService } from '../skills/SkillCatalogService';
import type { SkillRuntimeContext } from '../skills/skillRuntimeContext';
import type { ProjectRulesService } from '../rules/ProjectRulesService';
import type { AgentTaskState } from '../runtime/AgentTaskState';
import type { TierPolicy } from '../../../kernel/policy/tierPolicy';
import type { PlanToolsContext } from '../plans/tools/planTools';

/** Structural, host-neutral shape — satisfied by both `adapters/vscode/context/DiagnosticsService` and `adapters/node/HeadlessDiagnosticsService` without either needing to import the other. */
export interface DiagnosticsSummary {
  formatCompact(): string;
}

/**
 * Workspace/session-scoped services CE tool factories may depend on. Grows as more of
 * `builtinTools.ts`/`gitTools.ts`/`planTools.ts`/`logAuditTools.ts` moves onto the
 * `ToolFactoryContribution` pattern — see `docs/architecture/enterprise-migration-plan.md` for
 * what's covered so far vs. still hand-wired in `ThunderController`/`HeadlessAgentHost`.
 *
 * Fields that change over a session's lifetime (current turn's mode, in-flight task state, the
 * active plan) are exposed as accessor functions rather than snapshotted values, matching how
 * `ThunderController` already threads them into tool factories today (`() => this.session?.mode`,
 * etc.) — this bag is a formalization of that existing pattern, not a behavior change.
 */
export interface CeSessionServices {
  workspace: string;
  extensionRoot: string;
  ignoreService: IgnoreService;
  db?: ThunderDb;
  fts?: FtsIndex;
  repoMap?: RepoMapService;
  retriever?: HybridRetriever;
  budgeter?: ContextBudgeter;
  gitService?: GitService;
  diagnostics?: DiagnosticsSummary;
  memoryService?: MemoryService;
  skillCatalogService?: SkillCatalogService;
  getSkillRuntimeContext?: () => SkillRuntimeContext | undefined;
  getSessionMode?: () => string;
  getSessionId?: () => string;
  getActiveLogPath?: () => string;
  getTaskState?: () => AgentTaskState | undefined;
  allowNetwork?: () => boolean;
  planTools?: PlanToolsContext;

  // context-source dependencies
  projectRulesService?: ProjectRulesService;
  getTierPolicy?: () => TierPolicy | undefined;
  autoMemoryWriter?: AutoMemoryFileWriter;
  vectorIndexService?: VectorIndexService;
  languageService?: WorkspaceLanguageService;
}
