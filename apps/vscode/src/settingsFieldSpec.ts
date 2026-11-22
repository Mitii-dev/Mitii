import type { SettingsTab } from './protocol.js';

export type SettingsPage =
  | 'provider'
  | 'autocomplete'
  | 'workspace'
  | 'modes'
  | 'context'
  | 'features'
  | 'mcp'
  | 'developer';

export interface SettingsFieldSpec {
  id: string;
  page: SettingsPage;
  tab: SettingsTab;
  setting: string;
  label: string;
  kind: 'string' | 'int' | 'number' | 'boolean' | 'enum';
  /** Value the settings UI must show after save (raw stored value). */
  reflect: 'raw' | 'effective';
  sample: unknown;
  min?: number;
  max?: number;
}
