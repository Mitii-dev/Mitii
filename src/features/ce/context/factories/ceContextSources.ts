import type { ContextSourceContribution } from '../../../../interfaces/context';
import { ProjectRulesContextSource } from '../../rules/ProjectRulesService';
import { SkillCatalogContextSource } from '../../skills/SkillCatalogService';
import { ProjectCatalogContextSource } from '../../modes/ask/ProjectCatalog';
import { WorkspaceOverviewContextSource, FtsContextSource, RepoMapContextSource, MemoryContextSource } from '../sources/indexSources';
import { IndexedFileSearchContextSource } from '../sources/indexedFileSource';
import { AutoMemoryContextSource } from '../../memory/AutoMemoryFileWriter';
import { VectorContextSource } from '../sources/VectorContextSource';
import { CallGraphContextSource } from '../sources/callGraphSource';
import type { CeSessionServices } from '../../tools/sessionServices';

const OWNER = 'ce.context.indexing';

function source(
  id: string,
  phase: ContextSourceContribution['phase'],
  priority: number,
  create: (services: CeSessionServices) => ReturnType<ContextSourceContribution<CeSessionServices>['create']>
): ContextSourceContribution<CeSessionServices> {
  return { id, owner: OWNER, phase, priority, create };
}

/**
 * Real `ContextSourceContribution`s — wraps the existing context source classes, doesn't
 * reimplement them. Priority/phase mirror `HybridRetriever.SOURCE_TIERS`' current hard-coded
 * ordering only loosely (that ordering hasn't been touched by this migration); registries here
 * don't yet drive retrieval order themselves. See migration plan doc.
 */
export const ceContextSourceFactories: readonly ContextSourceContribution<CeSessionServices>[] = [
  source('project-rules', 'workspace', 10, (s) => {
    if (!s.projectRulesService) throw new Error('project-rules context source requires ProjectRulesService');
    return new ProjectRulesContextSource(s.projectRulesService, s.getTierPolicy);
  }),
  source('skill-catalog', 'workspace', 20, (s) => {
    if (!s.skillCatalogService) throw new Error('skill-catalog context source requires SkillCatalogService');
    return new SkillCatalogContextSource(s.skillCatalogService);
  }),
  source('project-catalog', 'workspace', 30, (s) => new ProjectCatalogContextSource(s.workspace)),
  source('workspace-overview', 'workspace', 40, (s) => new WorkspaceOverviewContextSource(s.workspace)),
  source('fts', 'semantic', 50, (s) => {
    if (!s.db) throw new Error('fts context source requires ThunderDb');
    return new FtsContextSource(s.db);
  }),
  source('indexed-file-search', 'semantic', 60, (s) => {
    if (!s.db) throw new Error('indexed-file-search context source requires ThunderDb');
    return new IndexedFileSearchContextSource(s.db, s.workspace);
  }),
  source('repo-map', 'workspace', 70, (s) => {
    if (!s.db) throw new Error('repo-map context source requires ThunderDb');
    return new RepoMapContextSource(s.db, s.workspace);
  }),
  source('memory', 'memory', 80, (s) => new MemoryContextSource(s.memoryService)),
  source('auto-memory', 'memory', 90, (s) => {
    if (!s.autoMemoryWriter) throw new Error('auto-memory context source requires AutoMemoryFileWriter');
    return new AutoMemoryContextSource(s.autoMemoryWriter);
  }),
  source('vector', 'semantic', 100, (s) => {
    if (!s.vectorIndexService) throw new Error('vector context source requires VectorIndexService');
    return new VectorContextSource(s.vectorIndexService, s.workspace);
  }),
  source('call-graph', 'semantic', 110, (s) => {
    if (!s.db || !s.languageService) throw new Error('call-graph context source requires ThunderDb and WorkspaceLanguageService');
    return new CallGraphContextSource(s.db, s.workspace, s.languageService);
  }),
];
