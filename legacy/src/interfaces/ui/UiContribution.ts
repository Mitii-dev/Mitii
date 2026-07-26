import type { JsonSchema } from '../shared/json';

export interface SettingsSectionContribution {
  id: string;
  owner: string;
  title: string;
  schema: JsonSchema;
}

export interface UiContribution {
  id: string;
  owner: string;
  settingsSections?: readonly SettingsSectionContribution[];
}
