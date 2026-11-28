/** Pure view-state derivations for the shell and chat panel. */

import type { useChatThreadState } from '../chat/hooks/useChatThreadState.js';
import type { useShellUiState } from '../shell/hooks/useShellUiState.js';
import type { useComposerState } from '../chat/hooks/useComposerState.js';
import type { useEngineSnapshot } from '../shell/hooks/useEngineSnapshot.js';
import { planArtifactToFollowView } from '../chat/planFollowView.js';
import { planFollowNeedsContinue } from '../chat/PlanFollowStrip.js';

export function deriveViewState(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'history' | 'pendingPlan' | 'busy' | 'pendingTaskList' | 'completedPlanStepIds'
    | 'messages' | 'reviewDismissed' | 'reviewFindings' | 'pendingNextActionPrompt'
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
    pendingNextActionPrompt,
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

  const rawPlanFollowView = planArtifactToFollowView(
    pendingPlan,
    busy && (mode === 'plan' || mode === 'agent'),
    pendingTaskList,
    completedPlanStepIds,
  );
  // Show while running or when open work remains — hide sticky "Plan complete".
  const planFollowView = !rawPlanFollowView
    ? null
    : busy || planFollowNeedsContinue(rawPlanFollowView, false)
      ? rawPlanFollowView
      : null;

  // Cursor-like: file changes track the latest assistant turn only.
  // Scanning older cards left the strip stuck on the first patch round.
  const latestAssistant = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant');

  const latestFileChanges =
    !latestAssistant ||
    reviewDismissed ||
    !(
      (latestAssistant.fileChanges?.totalCount ??
        latestAssistant.fileChanges?.files?.length ??
        0) > 0
    )
      ? undefined
      : latestAssistant.fileChanges;

  const latestReviewRunId =
    latestFileChanges?.runId ?? latestAssistant?.id;

  const latestAssistantWithChanges =
    latestFileChanges && latestAssistant ? latestAssistant : undefined;

  const latestFileChangeCount =
    latestFileChanges?.totalCount ?? latestFileChanges?.files.length ?? 0;

  const codeReviewEnabled = Boolean(
    settings.ui?.features?.codeReviewButton,
  );

  const activeReviewFindings =
    codeReviewEnabled && !reviewDismissed ? reviewFindings : [];

  // File changes always live on the composer strip (never in the chat feed).
  const showComposerReview =
    latestFileChangeCount > 0 || activeReviewFindings.length > 0;

  const showOnboarding = settings.onboarding?.completed === false;

  const discoveryDesk =
    pendingTaskList?.purpose === 'discovery' ||
    pendingTaskList?.source === 'discovery';
  const hasOpenExecutionItem = Boolean(
    !discoveryDesk &&
      pendingTaskList?.items.some(
        (item) => item.status === 'pending' || item.status === 'active',
      ),
  );
  const executionStarted = Boolean(
    (!discoveryDesk &&
      pendingTaskList?.items.some(
        (item) => item.status === 'active' || item.status === 'done',
      )) ||
      (completedPlanStepIds && completedPlanStepIds.size > 0),
  );
  const followNeedsContinue = planFollowNeedsContinue(planFollowView, busy);
  // Build when a plan is waiting to start; Continue strip owns mid-campaign.
  const showPendingPlanBuild =
    Boolean(pendingPlan) &&
    (mode === 'plan' || mode === 'agent') &&
    !executionStarted;
  // PlanFollowStrip Continue when checklist is live; else prose nextAction bar.
  const showContinueSliceBar =
    !busy &&
    !followNeedsContinue &&
    Boolean(pendingNextActionPrompt?.trim() || hasOpenExecutionItem);

  return {
    planFollowView,
    showPendingPlanBuild,
    followNeedsContinue,
    showComposerReview,
    activeReviewFindings,
    latestFileChanges,
    latestFileChangeCount,
    latestReviewRunId,
    latestAssistantWithChanges,
    showContinueSliceBar,
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
