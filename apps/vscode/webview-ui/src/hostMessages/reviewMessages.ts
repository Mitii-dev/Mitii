import { type AppApi } from '../app/appApi';
import { reviewGitFileKey } from '../app/reviewHelpers';
import { postToHost } from '../bridge';
import { type HostToWebviewMessage } from '../protocol';

export function handleReviewMessage(msg: HostToWebviewMessage, api: AppApi): boolean {
  const {
    modeRef,
    pendingAutoReviewRef,
    reviewRef,
    runReviewRef,
    setCodeReviewFileKey,
    setMode,
    setNav,
    setReview,
    setReviewBarExpandToken,
    setReviewFindings,
    uiRef,
  } = api;

  let handled = true;
  switch (msg.type) {
    case 'startReview': {
      setNav('chat');
      // Review = show git changes only (not a chat mode / not LLM).
      if (modeRef.current === 'review') setMode('ask');
      setReviewBarExpandToken((n) => n + 1);
      postToHost({ type: 'refreshReviewDiff' });
      // Optional auto-run is Code Review when the feature is enabled.
      if (msg.autoRun && uiRef.current.features.codeReviewButton) {
        pendingAutoReviewRef.current = { prompt: msg.prompt };
      } else {
        pendingAutoReviewRef.current = null;
      }
      break;
    }
    case 'setReviewDiff': {
      setReview(msg.review);
      const pending = pendingAutoReviewRef.current;
      if (!pending) break;
      if ((msg.review?.files?.length ?? 0) === 0) {
        pendingAutoReviewRef.current = null;
        break;
      }
      if (runReviewRef.current) {
        pendingAutoReviewRef.current = null;
        const promptOverride = pending.prompt;
        queueMicrotask(() => runReviewRef.current?.(promptOverride));
      }
      break;
    }
    case 'setReviewFindings':
      setReviewFindings(msg.findings);
      if (msg.findings.length > 0) {
        setCodeReviewFileKey(
          reviewGitFileKey(reviewRef.current?.files),
        );
      }
      break;
    default:
      handled = false;
  }
  return handled;
}
