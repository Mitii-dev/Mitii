/** Profile settings view modes and props. */

import { type DesktopSettings } from '../../../shared/settings.js';
import { type Dispatch, type SetStateAction } from 'react';

export type ModeId = 'ask' | 'plan' | 'agent';

export type ViewMode = 'gallery' | 'edit' | 'create';

export type CreateStep = 1 | 2 | 3 | 4;

export interface ProfileSettingsProps {
  draft: DesktopSettings;
  patch: (partial: unknown) => void;
  setDraft: Dispatch<SetStateAction<DesktopSettings>>;
  engineBaseUrl?: string;
  authToken?: string;
  hasApiKey: boolean;
  busy: boolean;
  onProfilesChanged?: (activeName: string) => void;
  onPersistSettings: (input: {
    settings: DesktopSettings;
    apiKey?: string;
    clearApiKey?: boolean;
  }) => Promise<void>;
}
