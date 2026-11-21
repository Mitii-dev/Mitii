/** Pure view-state derivations for the shell and chat panel. */

import type { useChatThreadState } from '../chat/hooks/useChatThreadState.js';
import type { useShellUiState } from '../shell/hooks/useShellUiState.js';
import type { useComposerState } from '../chat/hooks/useComposerState.js';
import type { useEngineSnapshot } from '../shell/hooks/useEngineSnapshot.js';
import { planArtifactToFollowView } from '../chat/planFollowView.js';

export function deriveViewState(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'history' | 'pendingPlan' | 'busy' | 'pendingTaskList' | 'completedPlanStepIds'
    | 'messages' | 'reviewDismissed' | 'reviewFindings'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'view' | 'chatLayout' | 'workspaceSide'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'mode'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'settings'
  >) {
  const {
    history,
    pendingPlan,
    busy,
    pendingTaskList,
    completedPlanStepIds,
    messages,
    reviewDismissed,
    reviewFindings,
    view,
    chatLayout,
    workspaceSide,
    mode,
    settings,
  } = deps;

  const recentHistory = [...history]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 5);

  const hasMoreHistory = history.length > 5;

  const inCodeMode = view === 'chat' && chatLayout === 'code';

  const showHistorySide = view === 'chat' && chatLayout === 'chat';

  const showActivityBar = inCodeMode || view === 'settings';

  /** Hide chat chrome in Code mode for extension sides — keep DOM mounted. */
  const hideCodeChat =
    chatLayout === 'code' &&
    (workspaceSide === 'mcp' ||
      workspaceSide === 'skills' ||
      workspaceSide === 'recipes');

  const settingsOpen = view === 'settings';

  const planFollowView = planArtifactToFollowView(
    pendingPlan,
    busy && (mode === 'plan' || mode === 'agent'),
    pendingTaskList,
    completedPlanStepIds,
  );

  const latestAssistantWithChanges = [...messages]
    .reverse()
    .find(
      (m) =>
        m.role === 'assistant' &&
        m.fileChanges &&
        m.fileChanges.files.length > 0,
    );

  const latestFileChanges = reviewDismissed
    ? undefined
    : latestAssistantWithChanges?.fileChanges;

  const latestReviewRunId =
    latestFileChanges?.runId ?? latestAssistantWithChanges?.id;

  const codeReviewEnabled = Boolean(
    settings.ui?.features?.codeReviewButton,
  );

  const activeReviewFindings =
    codeReviewEnabled && !reviewDismissed ? reviewFindings : [];

  // Chat layout: files live on the message card. Code layout: files live on
  // the composer strip. Never both.
  const showComposerReview =
    (chatLayout === 'code' && (latestFileChanges?.files.length ?? 0) > 0) ||
    activeReviewFindings.length > 0;

  const showOnboarding = settings.onboarding?.completed === false;

  return {
    planFollowView,
    showComposerReview,
    activeReviewFindings,
    latestFileChanges,
    latestReviewRunId,
    latestAssistantWithChanges,
    inCodeMode,
    recentHistory,
    hasMoreHistory,
    showHistorySide,
    showActivityBar,
    settingsOpen,
    hideCodeChat,
    codeReviewEnabled,
    showOnboarding,
  };
}
