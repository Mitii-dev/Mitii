import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import {
  createAskQuestionTool,
  createDiagnosticsTool,
  createProjectCatalogTool,
  createAnalyzeChangeImpactTool,
  createProposeFileScopeTool,
} from '../builtinTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.mode.ask';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for Ask-mode tools — wraps the existing tool factories, doesn't reimplement them. */
export const askModeToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('ask_question', () => toToolContribution(createAskQuestionTool(), OWNER)),
  factory('diagnostics', (s) => {
    if (!s.diagnostics) throw new Error('diagnostics tool requires a diagnostics summary in session services');
    return toToolContribution(createDiagnosticsTool(s.diagnostics as never), OWNER);
  }),
  factory('project_catalog', (s) => toToolContribution(createProjectCatalogTool(s.workspace), OWNER)),
  factory('analyze_change_impact', (s) => toToolContribution(createAnalyzeChangeImpactTool(s.workspace), OWNER)),
  factory('propose_file_scope', (s) => toToolContribution(createProposeFileScopeTool(s.workspace, s.ignoreService, s.db, s.getTaskState), OWNER)),
];
