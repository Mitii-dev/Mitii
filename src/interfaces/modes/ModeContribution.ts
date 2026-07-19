import type { ModeDefinition } from './ModeDefinition';

export interface ModeContribution {
  id: string;
  owner: string;
  definition: ModeDefinition;
}
