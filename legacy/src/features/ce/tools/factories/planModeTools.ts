import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import { createMarkStepCompleteTool, createProposePlanMutationTool } from '../../plans/tools/planTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.mode.plan';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for Plan-mode tools — wraps the existing tool factories, doesn't reimplement them. */
export const planModeToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('mark_step_complete', (s) => {
    if (!s.planTools) throw new Error('mark_step_complete tool requires a PlanToolsContext in session services');
    return toToolContribution(createMarkStepCompleteTool(s.planTools), OWNER);
  }),
  factory('propose_plan_mutation', (s) => {
    if (!s.planTools) throw new Error('propose_plan_mutation tool requires a PlanToolsContext in session services');
    return toToolContribution(createProposePlanMutationTool(s.planTools), OWNER);
  }),
];
