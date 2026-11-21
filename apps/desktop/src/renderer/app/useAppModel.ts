/** Composition root for desktop UI state: wires feature hooks in dependency order. */

import { useShellUiState } from '../shell/hooks/useShellUiState.js';
import { useEngineSnapshot } from '../shell/hooks/useEngineSnapshot.js';
import { useComposerState } from '../chat/hooks/useComposerState.js';
import { useChatThreadState } from '../chat/hooks/useChatThreadState.js';
import { useIndexState } from '../indexing/hooks/useIndexState.js';
import { useProviderState } from '../settings/hooks/useProviderState.js';
import { useModelPricing } from '../settings/hooks/useModelPricing.js';
import { useFeedScroll } from '../chat/hooks/useFeedScroll.js';
import { useShellChrome } from '../shell/hooks/useShellChrome.js';
import { useComposerEffects } from '../chat/hooks/useComposerEffects.js';
import { useEngineLifecycle } from '../shell/hooks/useEngineLifecycle.js';
import { useWorkspaceBootstrap } from '../shell/hooks/useWorkspaceBootstrap.js';
import { useDatabaseMcpSync } from '../chat/hooks/useDatabaseMcpSync.js';
import { useChatPersistence } from '../chat/hooks/useChatPersistence.js';
import { useRunAbort } from '../chat/hooks/useRunAbort.js';
import { useRunStream } from '../chat/hooks/useRunStream.js';
import { useIndexStatus } from '../indexing/hooks/useIndexStatus.js';
import { useWorkspaceSwitch } from '../shell/hooks/useWorkspaceSwitch.js';
import { useMentionSuggest } from '../chat/hooks/useMentionSuggest.js';
import { useSettingsActions } from '../settings/hooks/useSettingsActions.js';
import { useModeChange } from '../chat/hooks/useModeChange.js';
import { useThreadActions } from '../chat/hooks/useThreadActions.js';
import { useRunResume } from '../chat/hooks/useRunResume.js';
import { useRunSubmit } from '../chat/hooks/useRunSubmit.js';
import { usePlanActions } from '../chat/hooks/usePlanActions.js';
import { useSuspensionActions } from '../chat/hooks/useSuspensionActions.js';
import { usePins } from '../chat/hooks/usePins.js';
import { useShellActions } from '../shell/hooks/useShellActions.js';
import { deriveViewState } from './deriveViewState.js';

export function useAppModel() {
  const g0 = useShellUiState();
  const g1 = useEngineSnapshot();
  const g2 = useComposerState();
  const g3 = useChatThreadState();
  const g4 = useIndexState();
  const g5 = useProviderState();
  const g6 = useModelPricing({ ...g1, ...g5 });
  const g7 = useFeedScroll({ ...g3 });
  useShellChrome();
  useComposerEffects({ ...g2 });
  const g10 = useEngineLifecycle({ ...g1, ...g5 });
  useWorkspaceBootstrap({ ...g10, ...g1, ...g3, ...g0, ...g4, ...g5 });
  useDatabaseMcpSync({ ...g1, ...g2, ...g5, ...g0 });
  const g13 = useChatPersistence({ ...g0, ...g1, ...g3, ...g5 });
  const g14 = useRunAbort({ ...g3, ...g2, ...g4 });
  const g15 = useRunStream({ ...g3, ...g2, ...g0, ...g1 });
  const g16 = useIndexStatus({ ...g4, ...g1 });
  const g17 = useWorkspaceSwitch({ ...g3, ...g1, ...g0, ...g14, ...g10 });
  const g18 = useMentionSuggest({ ...g2, ...g1, ...g5 });
  const g19 = useSettingsActions({ ...g1, ...g3, ...g10, ...g5, ...g0 });
  const g20 = useModeChange({ ...g2, ...g1, ...g19, ...g10 });
  const g21 = useThreadActions({ ...g14, ...g3, ...g13, ...g1, ...g0 });
  const g22 = useRunResume({ ...g1, ...g3, ...g14, ...g2, ...g7, ...g10, ...g15, ...g0, ...g13 });
  const g23 = useRunSubmit({ ...g2, ...g1, ...g3, ...g0, ...g14, ...g7, ...g10, ...g15, ...g13 });
  const g24 = usePlanActions({ ...g3, ...g2, ...g23, ...g1 });
  const g25 = useSuspensionActions({ ...g3, ...g22, ...g2 });
  const g26 = usePins({ ...g2 });
  const g27 = useShellActions({ ...g0 });
  const g28 = deriveViewState({ ...g3, ...g0, ...g2, ...g1 });

  return {
    ...g0,
    ...g1,
    ...g2,
    ...g3,
    ...g4,
    ...g5,
    ...g6,
    ...g7,
    ...g10,
    ...g13,
    ...g14,
    ...g15,
    ...g16,
    ...g17,
    ...g18,
    ...g19,
    ...g20,
    ...g21,
    ...g22,
    ...g23,
    ...g24,
    ...g25,
    ...g26,
    ...g27,
    ...g28,
  };
}

export type AppModel = ReturnType<typeof useAppModel>;
