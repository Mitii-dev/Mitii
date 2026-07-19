import type { JsonSchema } from '../shared/json';

export interface SettingsContribution {
  id: string;
  owner: string;
  namespace: string;
  schema: JsonSchema;
  legacyKeys?: readonly string[];
  edition?: 'ce' | 'ee';
}
