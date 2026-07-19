import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import { createRepoMapTool, createRetrieveContextTool } from '../builtinTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.context.indexing';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for repo-map/context-retrieval tools — wraps the existing tool factories, doesn't reimplement them. */
export const contextToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('repo_map', (s) => {
    if (!s.repoMap) throw new Error('repo_map tool requires RepoMapService in session services');
    return toToolContribution(createRepoMapTool(s.repoMap), OWNER);
  }),
  factory('retrieve_context', (s) => {
    if (!s.retriever || !s.budgeter) throw new Error('retrieve_context tool requires HybridRetriever and ContextBudgeter in session services');
    return toToolContribution(createRetrieveContextTool(s.retriever, s.budgeter), OWNER);
  }),
];
