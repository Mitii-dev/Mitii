import type { ToolContribution, ToolFactoryContribution } from '../../../../interfaces/tools';
import type { CeSessionServices } from '../sessionServices';

export function makeToolFactory(owner: string) {
  return function factory(
    id: string,
    create: (services: CeSessionServices) => ToolContribution
  ): ToolFactoryContribution<unknown, CeSessionServices> {
    return { id, owner, create };
  };
}
