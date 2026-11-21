/** Chat thread, run, token, plan and review state. */

import { useState, useRef } from 'react';
import { type TokenUsageState, emptyTokenUsage } from '@mitii/ui-react';
import { type DesktopSuspension } from '../../../shared/suspension.js';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
} from '../../../shared/planFormat.js';
import { type ReviewFinding } from '../../../shared/reviewFindings.js';
import { type ChatMessage, type HistoryThread } from '../chatTypes.js';

export function useChatThreadState() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [threadId, setThreadId] = useState<string | undefined>();

  const [history, setHistory] = useState<HistoryThread[]>([]);

  const [historyLoading, setHistoryLoading] = useState(false);

  const [busy, setBusy] = useState(false);

  /** True while an agent stream is in flight — survives settings/UI busy toggles. */
  const runActiveRef = useRef(false);

  const runAbortRef = useRef<AbortController | null>(null);

  const [tokenUsage, setTokenUsage] = useState<TokenUsageState>(emptyTokenUsage);

  const tokenUsageRef = useRef<TokenUsageState>(emptyTokenUsage());

  const [suspension, setSuspension] = useState<DesktopSuspension | null>(null);

  const [pendingPlan, setPendingPlan] = useState<PlanArtifact | null>(null);

  const [pendingPlanStrategy, setPendingPlanStrategy] =
    useState<PlanStrategyDecision | null>(null);

  const [pendingTaskList, setPendingTaskList] = useState<TaskList | null>(null);

  const [completedPlanStepIds, setCompletedPlanStepIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);

  const [reviewDismissed, setReviewDismissed] = useState(false);

  const [editorContext, setEditorContext] = useState<{
    activePath: string | null;
    openPaths: string[];
  }>({ activePath: null, openPaths: [] });

  const feedRef = useRef<HTMLDivElement>(null);

  const feedEndRef = useRef<HTMLDivElement>(null);

  const pendingThreadRef = useRef<string | null>(null);

  const pendingNewChatRef = useRef(false);

  const historyWorkspaceRef = useRef<string | undefined>(undefined);

  return {
    feedEndRef,
    messages,
    suspension,
    historyWorkspaceRef,
    setHistory,
    setHistoryLoading,
    pendingThreadRef,
    pendingNewChatRef,
    setThreadId,
    setMessages,
    setPendingPlan,
    setPendingPlanStrategy,
    setPendingTaskList,
    setCompletedPlanStepIds,
    setTokenUsage,
    setSuspension,
    threadId,
    tokenUsageRef,
    tokenUsage,
    runAbortRef,
    setBusy,
    runActiveRef,
    history,
    busy,
    setReviewDismissed,
    editorContext,
    pendingPlan,
    pendingPlanStrategy,
    pendingTaskList,
    completedPlanStepIds,
    reviewDismissed,
    reviewFindings,
    feedRef,
    setReviewFindings,
    historyLoading,
    setEditorContext,
  };
}
