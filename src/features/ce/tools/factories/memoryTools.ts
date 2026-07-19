import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import { createMemorySearchTool, createMemoryWriteTool, createSaveTaskStateTool } from '../builtinTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.context.memory';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for the memory feature — wraps the existing tool factories, doesn't reimplement them. */
export const memoryToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('memory_search', (s) => {
    if (!s.memoryService) throw new Error('memory_search tool requires MemoryService in session services');
    return toToolContribution(createMemorySearchTool(s.memoryService), OWNER);
  }),
  factory('memory_write', (s) => {
    if (!s.memoryService) throw new Error('memory_write tool requires MemoryService in session services');
    return toToolContribution(createMemoryWriteTool(s.memoryService, s.getSessionId ?? (() => '')), OWNER);
  }),
  factory('save_task_state', (s) => {
    if (!s.memoryService) throw new Error('save_task_state tool requires MemoryService in session services');
    return toToolContribution(createSaveTaskStateTool(s.memoryService, s.getSessionId ?? (() => ''), s.getTaskState), OWNER);
  }),
];
