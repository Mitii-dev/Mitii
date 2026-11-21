import type { ShellNavApi } from '../hooks/useShellNav';
import type { IntensityApi } from '../hooks/useIntensity';
import type { IndexStatusApi } from '../hooks/useIndexStatus';
import type { ThreadsApi } from '../hooks/useThreads';
import type { SettingsStateApi } from '../hooks/useSettingsState';
import type { RunStreamApi } from '../hooks/useRunStream';
import type { ReviewStateApi } from '../hooks/useReviewState';
import type { SettingsActionsApi } from '../hooks/useSettingsActions';
import type { ComposerApi } from '../hooks/useComposer';
import type { AutomationsApi } from '../hooks/useAutomations';

/** Flat view of every hook slice the shell composes; containers and host-message handlers read from it. */
export type AppApi = ShellNavApi
  & IntensityApi
  & IndexStatusApi
  & ThreadsApi
  & SettingsStateApi
  & RunStreamApi
  & ReviewStateApi
  & SettingsActionsApi
  & ComposerApi
  & AutomationsApi;
