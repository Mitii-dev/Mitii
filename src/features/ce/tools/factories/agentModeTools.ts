import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import { createRunCommandTool, createFetchWebTool, createSpawnSubagentTool, createSpawnResearchAgentTool } from '../builtinTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.mode.agent';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for Agent-mode tools — wraps the existing tool factories, doesn't reimplement them. */
export const agentModeToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('run_command', (s) => toToolContribution(createRunCommandTool(s.workspace, s.getSessionMode ?? (() => 'plan')), OWNER)),
  factory('fetch_web', (s) => toToolContribution(createFetchWebTool(s.allowNetwork ?? (() => false)), OWNER)),
  factory('spawn_subagent', () => toToolContribution(createSpawnSubagentTool(), OWNER)),
  factory('spawn_research_agent', () => toToolContribution(createSpawnResearchAgentTool(), OWNER)),
];
