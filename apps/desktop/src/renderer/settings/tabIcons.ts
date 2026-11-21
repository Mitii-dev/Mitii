/** Settings tab icon registry. */

import { type SettingsTabId } from '../../shared/settings.js';
import {
  IconWorkspace,
  IconFiles,
  IconProvider,
  IconContext,
  IconFeatures,
  IconDeveloper,
} from '../shell/ActivityIcons.js';

export const SETTINGS_TAB_ICONS: Record<
  SettingsTabId,
  (props: { size?: number }) => JSX.Element
> = {
  storage: IconWorkspace,
  workspaces: IconFiles,
  profiles: IconProvider,
  context: IconContext,
  features: IconFeatures,
  debug: IconDeveloper,
};
