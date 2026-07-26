import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import {
  createReadFileTool,
  createReadFilesTool,
  createListFilesTool,
  createResolvePathTool,
  createWriteFileTool,
  createApplyPatchTool,
  createSearchTool,
  createSearchBatchTool,
  createSearchScriptCatalogTool,
  createExecuteWorkspaceScriptTool,
} from '../builtinTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.tools.filesystem';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for the filesystem-tools feature — wraps the existing tool factories, doesn't reimplement them. */
export const filesystemToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('read_file', (s) => toToolContribution(createReadFileTool(s.workspace, s.ignoreService, s.db), OWNER)),
  factory('read_files', (s) => toToolContribution(createReadFilesTool(s.workspace, s.ignoreService, s.db), OWNER)),
  factory('list_files', (s) => toToolContribution(createListFilesTool(s.workspace, s.ignoreService), OWNER)),
  factory('resolve_path', (s) => toToolContribution(createResolvePathTool(s.workspace, s.ignoreService, s.db), OWNER)),
  factory('write_file', (s) => toToolContribution(createWriteFileTool(s.workspace, s.ignoreService), OWNER)),
  factory('apply_patch', (s) => toToolContribution(createApplyPatchTool(s.workspace, s.ignoreService), OWNER)),
  factory('search', (s) => {
    if (!s.fts) throw new Error('search tool requires FtsIndex in session services');
    return toToolContribution(createSearchTool(s.fts, s.workspace), OWNER);
  }),
  factory('search_batch', (s) => {
    if (!s.fts) throw new Error('search_batch tool requires FtsIndex in session services');
    return toToolContribution(createSearchBatchTool(s.fts, s.workspace), OWNER);
  }),
  factory('search_script_catalog', (s) => toToolContribution(createSearchScriptCatalogTool(s.workspace, s.extensionRoot), OWNER)),
  factory('execute_workspace_script', (s) => toToolContribution(createExecuteWorkspaceScriptTool(s.workspace, s.extensionRoot, s.ignoreService), OWNER)),
];
