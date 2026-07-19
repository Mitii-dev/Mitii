import type { ToolFactoryContribution } from '../../../../interfaces/tools';
import { toToolContribution } from '../../../../kernel/tools';
import { createUseSkillTool } from '../builtinTools';
import type { CeSessionServices } from '../sessionServices';
import { makeToolFactory } from './toolFactoryHelper';

const OWNER = 'ce.skills';
const factory = makeToolFactory(OWNER);

/** Real `ToolFactoryContribution`s for the skills feature — wraps the existing tool factory, doesn't reimplement it. */
export const skillsToolFactories: readonly ToolFactoryContribution<unknown, CeSessionServices>[] = [
  factory('use_skill', (s) => {
    if (!s.skillCatalogService) throw new Error('use_skill tool requires SkillCatalogService in session services');
    return toToolContribution(createUseSkillTool(s.skillCatalogService, s.getSkillRuntimeContext), OWNER);
  }),
];
