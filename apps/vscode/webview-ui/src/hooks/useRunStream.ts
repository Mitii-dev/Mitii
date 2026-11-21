import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EMPTY_TOKEN_USAGE } from '../app/turnHelpers';
import { type ChatTurn } from '../components/MessageList';
import { type PlanView, type TokenUsageSnapshot } from '../protocol';
import type { SettingsStateApi } from './useSettingsState';

export function useRunStream(deps: SettingsStateApi) {
  const {
    providerRef,
  } = deps;

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [running, setRunning] = useState(false);

  const runningRef = useRef(false);
  runningRef.current = running;
  const [error, setError] = useState<string | null>(null);

  const [tokenUsage, setTokenUsage] =
    useState<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);

  const [clarifyText, setClarifyText] = useState('');

  const [plan, setPlan] = useState<PlanView | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PlanView | null>(null);
  const pendingPlanRef = useRef<PlanView | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const lastTurnCountRef = useRef(0);
  const activeAssistantId = useRef<string | null>(null);

  const applyTokenUsage = useCallback(
    (usage: TokenUsageSnapshot) => {
      setTokenUsage((prev) => {
        const keepLiveDuringRun =
          runningRef.current && prev.live && usage.live === false;
        const shouldKeepLiveBreakdown =
          (usage.contextBreakdown === undefined && usage.live && prev.live) ||
          (keepLiveDuringRun && prev.contextBreakdown !== undefined);
        const current = providerRef.current;
        const providerContextWindow =
          current.effectiveContextWindow || current.contextWindow;
        return {
          ...usage,
          live: keepLiveDuringRun ? true : usage.live,
          contextWindow:
            usage.contextWindow ||
            providerContextWindow ||
            prev.contextWindow ||
            32768,
          contextBreakdown:
            usage.contextBreakdown ??
            (shouldKeepLiveBreakdown ? prev.contextBreakdown : undefined),
        };
      });
    },
    [],
  );

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior) => {
    const scroll = () => {
      const target = messagesRef.current;
      if (!target) return;
      bottomRef.current?.scrollIntoView({ block: 'end', behavior });
      target.scrollTop = target.scrollHeight;
    };
    window.requestAnimationFrame(() => {
      scroll();
      window.requestAnimationFrame(scroll);
    });
  }, []);

  const markSuspensionResumed = useCallback((runId: string) => {
    setRunning(true);
    setTurns((prev) =>
      prev.map((turn) =>
        turn.suspension?.runId === runId
          ? { ...turn, suspension: undefined, streaming: true }
          : turn,
      ),
    );
  }, []);

  useEffect(() => {
    pendingPlanRef.current = pendingPlan;
  }, [pendingPlan]);

  useLayoutEffect(() => {
    const turnCountChanged = turns.length !== lastTurnCountRef.current;
    lastTurnCountRef.current = turns.length;
    const shouldScroll =
      forceScrollToBottomRef.current ||
      stickToBottomRef.current ||
      (running && turnCountChanged);
    if (!shouldScroll) return;
    forceScrollToBottomRef.current = false;
    scrollMessagesToBottom(running ? 'auto' : 'smooth');
  }, [running, scrollMessagesToBottom, turns]);

  const onMessagesScroll = useCallback(() => {
    const target = messagesRef.current;
    if (!target) return;
    const distanceFromBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 72;
  }, []);

  return {
    turns,
    setTurns,
    running,
    setRunning,
    runningRef,
    error,
    setError,
    tokenUsage,
    setTokenUsage,
    clarifyText,
    setClarifyText,
    plan,
    setPlan,
    pendingPlan,
    setPendingPlan,
    pendingPlanRef,
    messagesRef,
    bottomRef,
    stickToBottomRef,
    forceScrollToBottomRef,
    lastTurnCountRef,
    activeAssistantId,
    applyTokenUsage,
    scrollMessagesToBottom,
    markSuspensionResumed,
    onMessagesScroll,
  };
}

export type RunStreamApi = ReturnType<typeof useRunStream>;
