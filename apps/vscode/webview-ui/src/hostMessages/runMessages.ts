import { appendActivitySegment } from '../activitySegments';
import { type AppApi } from '../app/appApi';
import { reviewGitFileKey } from '../app/reviewHelpers';
import { appendTextSegment, uid, isNoiseWarning } from '../app/turnHelpers';
import { resolveDisplayedAssistantText } from '../assistantDisplay';
import { type HostToWebviewMessage } from '../protocol';

export function handleRunMessage(msg: HostToWebviewMessage, api: AppApi): boolean {
  const {
    activeAssistantId,
    applyTokenUsage,
    codeReviewRunningRef,
    forceScrollToBottomRef,
    markSuspensionResumed,
    pendingPlanRef,
    reviewRef,
    setCodeReviewFileKey,
    setCodeReviewRunning,
    setError,
    setPendingPlan,
    setPlan,
    setRunning,
    setSettingsSaving,
    setTokenUsage,
    setTurns,
    stickToBottomRef,
    uiRef,
  } = api;

  let handled = true;
  switch (msg.type) {
    case 'run.started': {
      setRunning(true);
      const isCodeReview = msg.mode === 'review';
      setCodeReviewRunning(isCodeReview);
      codeReviewRunningRef.current = isCodeReview;
      setError(null);
      setTokenUsage((prev) => ({ ...prev, live: true }));
      // Keep a pending-plan handoff visible, but clear stale plans for new runs.
      if (msg.mode === 'plan' || !pendingPlanRef.current) setPlan(null);
      stickToBottomRef.current = true;
      forceScrollToBottomRef.current = true;
      const userId = uid('user');
      const asstId = uid('asst');
      activeAssistantId.current = asstId;
      setTurns((prev) => [
        ...prev,
        {
          id: userId,
          role: 'user',
          text: msg.prompt,
          mode: msg.mode,
          segments: [],
        },
        {
          id: asstId,
          role: 'assistant',
          text: '',
          mode: msg.mode,
          streaming: true,
          segments: [],
          warnings: [],
        },
      ]);
      break;
    }
    case 'run.event': {
      const id = activeAssistantId.current;
      if (!id) break;
      if (msg.event.kind === 'delta') break;
      if (msg.event.kind === 'thinking' && !uiRef.current.showReasoning) break;
      // "Preparing tool" is a transient placeholder immediately superseded
      // by "Running <tool>" a moment later — drop it, it adds noise without signal.
      if (msg.event.kind === 'tool' && msg.event.title === 'Preparing tool') {
        break;
      }
      // Budget/context operational notices — hide from banner and timeline.
      if (
        msg.event.kind === 'warning' &&
        msg.event.detail?.trim() &&
        isNoiseWarning(msg.event.detail)
      ) {
        break;
      }
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                warnings:
                  msg.event.kind === 'warning' && msg.event.detail?.trim()
                    ? Array.from(
                        new Set([...(t.warnings ?? []), msg.event.detail.trim()]),
                      )
                    : t.warnings,
                segments: appendActivitySegment(
                  t.segments,
                  msg.event,
                  uiRef.current.reasoningPreviewMaxChars,
                ),
              }
            : t,
        ),
      );
      break;
    }
    case 'run.delta': {
      const id = activeAssistantId.current;
      if (!id) break;
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                text: `${t.text}${msg.text}`,
                segments: appendTextSegment(t.segments, msg.text),
              }
            : t,
        ),
      );
      break;
    }
    case 'run.suspended': {
      setRunning(false);
      codeReviewRunningRef.current = false;
      setCodeReviewRunning(false);
      const id = activeAssistantId.current;
      if (!id) break;
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, suspension: msg.suspension, streaming: false }
            : t,
        ),
      );
      break;
    }
    case 'run.resumed':
      setRunning(true);
      setTokenUsage((prev) => ({ ...prev, live: true }));
      markSuspensionResumed(msg.runId);
      break;
    case 'run.result': {
      setRunning(false);
      if (codeReviewRunningRef.current) {
        setCodeReviewFileKey(
          reviewGitFileKey(reviewRef.current?.files),
        );
      }
      codeReviewRunningRef.current = false;
      setCodeReviewRunning(false);
      const id = activeAssistantId.current;
      activeAssistantId.current = null;
      if (msg.plan !== undefined) setPlan(msg.plan ?? null);
      if (msg.pendingPlan !== undefined) {
        setPendingPlan(msg.pendingPlan);
        if (msg.pendingPlan) setPlan(msg.pendingPlan);
      }
      setTurns((prev) =>
        prev.map((t) => {
          if (!id || t.id !== id) return t;
          const nextText = resolveDisplayedAssistantText({
            streamedText: t.text,
            finalAnswer: msg.answer?.trim()
              ? msg.answer
              : msg.error
                ? `Error: ${msg.error}`
                : `(${msg.status})`,
          });
          // Streamed segments already display correctly; only when the
          // final answer overrides them do we collapse the streamed text
          // into one trailing segment, keeping prior activity groups intact.
          const segments =
            nextText === t.text
              ? t.segments
              : [
                  ...t.segments.filter((seg) => seg.kind === 'activity'),
                  {
                    id: uid('seg'),
                    kind: 'text' as const,
                    text: nextText,
                    at: Date.now(),
                  },
                ];
          return {
            ...t,
            streaming: false,
            status: msg.status,
            route: msg.route,
            text: nextText,
            segments,
            suspension: undefined,
          };
        }),
      );
      break;
    }
    case 'run.cancelled':
      setRunning(false);
      codeReviewRunningRef.current = false;
      setCodeReviewRunning(false);
      break;
    case 'error':
      setError(msg.message);
      setRunning(false);
      codeReviewRunningRef.current = false;
      setCodeReviewRunning(false);
      setSettingsSaving(false);
      break;
    case 'run.fileChanges': {
      const id = activeAssistantId.current;
      setTurns((prev) => {
        const targetId =
          id ??
          [...prev]
            .reverse()
            .find((turn) => turn.role === 'assistant')?.id;
        if (!targetId) return prev;
        return prev.map((t) =>
          t.id === targetId ? { ...t, fileChanges: msg.changes } : t,
        );
      });
      break;
    }
    case 'fileChanges.undone': {
      setTurns((prev) =>
        prev.map((t) =>
          t.fileChanges?.runId === msg.runId
            ? { ...t, fileChanges: undefined }
            : t,
        ),
      );
      break;
    }
    case 'setPlan':
      setPlan(msg.plan);
      break;
    case 'tokenUsage':
      applyTokenUsage(msg.usage);
      break;
    default:
      handled = false;
  }
  return handled;
}
