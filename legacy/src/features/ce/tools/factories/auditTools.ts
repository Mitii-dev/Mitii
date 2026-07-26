import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import {
  createAnalyzeLogDirectoryTool,
  createAnalyzeJsonlTool,
  createQueryLogEventsTool,
  createListLogsTool,
} from '../../audit/tools/logAuditTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.audit.local';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for the local-audit feature — wraps the existing tool factories, doesn't reimplement them. */
export const auditToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('analyze_log_directory', (s) => toToolContribution(createAnalyzeLogDirectoryTool(s.workspace, s.ignoreService, s.getActiveLogPath), OWNER)),
  factory('analyze_jsonl', (s) => toToolContribution(createAnalyzeJsonlTool(s.workspace, s.ignoreService), OWNER)),
  factory('query_log_events', (s) => toToolContribution(createQueryLogEventsTool(s.workspace, s.ignoreService), OWNER)),
  factory('list_logs', (s) => toToolContribution(createListLogsTool(s.workspace), OWNER)),
];
