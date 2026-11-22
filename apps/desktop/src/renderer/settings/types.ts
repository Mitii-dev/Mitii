/** Settings panel public props and tab ids. */

import { type DesktopSettings, type SettingsTabId } from '../../shared/settings.js';

export type FeatureTabId =
  | 'autocomplete'
  | 'review'
  | 'agent'
  | 'search'
  | 'index';

export interface SettingsPanelProps {
  settings: DesktopSettings;
  workspaceRoot: string;
  hasApiKey: boolean;
  hasSearchApiKey: boolean;
  busy: boolean;
  engineBaseUrl?: string;
  authToken?: string;
  /** Controlled settings category (from activity bar). */
  tab?: SettingsTabId;
  onTabChange?: (tab: SettingsTabId) => void;
  /** Controlled feature sub-tab (e.g. Semantic index). */
  featureTab?: FeatureTabId;
  onFeatureTabChange?: (tab: FeatureTabId) => void;
  /** Hide the internal text nav when the activity bar owns categories. */
  hideSideNav?: boolean;
  onSave: (input: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
    searchApiKey?: string;
    clearSearchApiKey?: boolean;
  }) => Promise<void>;
  onPickWorkspace?: () => void;
  onProfilesChanged?: (activeName: string) => void;
  onIndexChanged?: () => void;
  onIndexStarted?: () => void;
  /** After Delete Cache/Logs — parent should reload snapshot/settings. */
  onWorkspaceCacheCleared?: () => void;
}
