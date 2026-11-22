import { type AppApi } from '../app/appApi';
import { EMPTY_TOKEN_USAGE, toChatTurn } from '../app/turnHelpers';
import { type HostToWebviewMessage } from '../protocol';

export function handleWorkspaceMessage(msg: HostToWebviewMessage, api: AppApi): boolean {
  const {
    applyIndexStatus,
    forceScrollToBottomRef,
    providerRef,
    setActiveThreadId,
    setAutomationError,
    setAutomationLoading,
    setAutomationRuns,
    setAutomationSpecs,
    setCheckpoints,
    setHistory,
    setMemories,
    setNav,
    setPendingPlan,
    setPlan,
    setTokenUsage,
    setTurns,
    stickToBottomRef,
  } = api;

  let handled = true;
  switch (msg.type) {
    case 'index.status':
      applyIndexStatus(msg.index);
      break;
    case 'history':
      setHistory(msg.threads);
      setActiveThreadId(msg.activeThreadId);
      break;
    case 'thread.loaded': {
      setActiveThreadId(msg.threadId);
      stickToBottomRef.current = true;
      forceScrollToBottomRef.current = true;
      setTokenUsage({
        ...EMPTY_TOKEN_USAGE,
        contextWindow:
          providerRef.current.effectiveContextWindow ||
          providerRef.current.contextWindow ||
          32768,
      });
      setTurns(msg.messages.map((m) => toChatTurn(m)));
      const loadedPlan = msg.pendingPlan ?? null;
      setPendingPlan(loadedPlan);
      setPlan(loadedPlan);
      setNav('chat');
      break;
    }
    case 'setMemories':
      setMemories(msg.memories);
      break;
    case 'setCheckpoints':
      setCheckpoints(msg.checkpoints);
      break;
    case 'automationsResult':
      setAutomationSpecs(msg.specs);
      setAutomationRuns(msg.runs);
      setAutomationError(msg.error ?? null);
      setAutomationLoading(false);
      break;
    default:
      handled = false;
  }
  return handled;
}
