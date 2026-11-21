/** NDJSON stream consumption and file-change resolution. */

import { useCallback } from 'react';
import { type DesktopPromptStreamLine } from '../../../shared/protocol.js';
import {
  type DesktopActivityItem,
  runEventToActivity,
  appendActivity,
} from '../../../shared/activity.js';
import { type DesktopSuspension, extractSuspension } from '../../../shared/suspension.js';
import { type TokenUsageState, addTurnTokens } from '@mitii/ui-react';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
  parseTaskList,
  extractPlanFromRunResult,
  resolvePlanDisplayText,
} from '../../../shared/planFormat.js';
import { breakdownFromPromptReady } from '../../../shared/contextUsage.js';
import {
  collectMutatedPathsFromEvent,
  type DesktopFileChanges,
} from '../../../shared/fileChanges.js';
import { extractAssistantText, finalizeAssistantText, fetchFileChanges } from '../../api.js';
import type { useChatThreadState } from './useChatThreadState.js';
import type { useComposerState } from './useComposerState.js';
import type { useShellUiState } from '../../shell/hooks/useShellUiState.js';
import type { useEngineSnapshot } from '../../shell/hooks/useEngineSnapshot.js';
import { extractTurnTokens, isToolCompleted } from '../turnTokens.js';

export function useRunStream(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'tokenUsageRef' | 'setTokenUsage' | 'setMessages' | 'setPendingTaskList'
    | 'setCompletedPlanStepIds' | 'setSuspension' | 'setPendingPlan'
    | 'setPendingPlanStrategy'
  > &
  Pick<
    ReturnType<typeof useComposerState>,
    'pilotAutoContinueStreakRef' | 'approvalModeRef' | 'setPendingAutoContinue'
  > &
  Pick<
    ReturnType<typeof useShellUiState>,
    'workspaceInvalidateSeq' | 'setWorkspaceInvalidate'
  > &
  Pick<
    ReturnType<typeof useEngineSnapshot>,
    'engine'
  >) {
  const {
    tokenUsageRef,
    setTokenUsage,
    setMessages,
    setPendingTaskList,
    setCompletedPlanStepIds,
    setSuspension,
    setPendingPlan,
    setPendingPlanStrategy,
    pilotAutoContinueStreakRef,
    approvalModeRef,
    setPendingAutoContinue,
    workspaceInvalidateSeq,
    setWorkspaceInvalidate,
    engine,
  } = deps;

  const consumeStream = useCallback(
    async (
      lines: AsyncIterable<DesktopPromptStreamLine>,
      assistantId: string,
      options?: { formatPlanAnswer?: boolean },
    ): Promise<{
      assistant: string;
      activity: DesktopActivityItem[];
      suspension: DesktopSuspension | null;
      mutatedPaths: string[];
      tokenUsage: TokenUsageState;
      plan?: PlanArtifact;
      planStrategy?: PlanStrategyDecision;
      taskList?: TaskList;
    }> => {
      let assistant = '';
      let activity: DesktopActivityItem[] = [];
      let nextSuspension: DesktopSuspension | null = null;
      let resultPlan: PlanArtifact | undefined;
      let resultPlanStrategy: PlanStrategyDecision | undefined;
      let resultTaskList: TaskList | undefined;
      const mutated = new Set<string>();
      let usage: TokenUsageState = { ...tokenUsageRef.current, live: true };

      const pushUsage = (next: TokenUsageState) => {
        usage = next;
        tokenUsageRef.current = next;
        setTokenUsage(next);
      };

      // Paint live=true immediately — model_turn tokens only arrive after each
      // turn completes, so without this the meter stays stale until tab switch.
      pushUsage(usage);

      const paintAssistant = (snapshot: {
        text: string;
        activity: DesktopActivityItem[];
        streaming: boolean;
      }) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: snapshot.text,
                  activity: snapshot.activity,
                  streaming: snapshot.streaming,
                }
              : m,
          ),
        );
      };

      for await (const line of lines) {
        if (line.op === 'error') {
          paintAssistant({
            text: assistant,
            activity,
            streaming: false,
          });
          throw new Error(line.message ?? line.error);
        }
        if (line.op === 'event') {
          const eventRecord = line.event as unknown as Record<string, unknown>;
          if (eventRecord?.type === 'task_list_updated') {
            const liveList = parseTaskList(eventRecord.taskList);
            if (liveList) {
              resultTaskList = liveList;
              setPendingTaskList(liveList);
            }
            if (Array.isArray(eventRecord.completedPlanStepIds)) {
              const ids = eventRecord.completedPlanStepIds.filter(
                (id): id is string => typeof id === 'string' && id.length > 0,
              );
              if (ids.length > 0) {
                setCompletedPlanStepIds(new Set(ids));
              }
            }
          }
          const tokens = extractTurnTokens(line.event);
          if (tokens) {
            pushUsage(
              addTurnTokens({ ...usage, live: true }, tokens.in, tokens.out, {
                hit: tokens.cacheHit,
                miss: tokens.cacheMiss,
              }),
            );
          }
          const breakdown = breakdownFromPromptReady(line.event);
          if (breakdown) {
            pushUsage({
              ...usage,
              contextBreakdown: breakdown,
              contextWindow: breakdown.contextWindow || usage.contextWindow,
              live: true,
            });
          }
          if (isToolCompleted(line.event)) {
            pushUsage({
              ...usage,
              toolCalls: usage.toolCalls + 1,
            });
          }
          const writePaths = collectMutatedPathsFromEvent(line.event);
          for (const path of writePaths) mutated.add(path);
          // Mid-stream: refresh explorer/SCM as soon as write tools complete.
          if (isToolCompleted(line.event) && writePaths.length > 0) {
            pilotAutoContinueStreakRef.current = 0;
            workspaceInvalidateSeq.current += 1;
            setWorkspaceInvalidate({
              seq: workspaceInvalidateSeq.current,
              paths: writePaths,
            });
          }
          const item = runEventToActivity(line.event);
          if (item) {
            activity = appendActivity(activity, item);
          }
          const delta = extractAssistantText(line);
          if (delta) assistant += delta;
          paintAssistant({
            text: assistant,
            activity,
            streaming: true,
          });
        }
        if (line.op === 'result') {
          assistant = finalizeAssistantText(assistant, line);
          nextSuspension = extractSuspension(line.result);
          if (nextSuspension) {
            // Pilot: at most one silent Continue. Further stalls surface the
            // card so the user can Continue/Stop (avoids reasoning-budget spin).
            if (
              nextSuspension.kind === 'continue_required' &&
              approvalModeRef.current === 'pilot' &&
              pilotAutoContinueStreakRef.current < 1
            ) {
              pilotAutoContinueStreakRef.current += 1;
              setPendingAutoContinue(nextSuspension);
            } else {
              if (nextSuspension.kind === 'continue_required') {
                pilotAutoContinueStreakRef.current = 0;
              }
              setSuspension(nextSuspension);
            }
          }
          const extracted = extractPlanFromRunResult(line.result);
          resultPlan = extracted.plan;
          resultPlanStrategy = extracted.planStrategy;
          resultTaskList = extracted.taskList;
          // Don't paint PlanFollow from a clarify-only placeholder plan —
          // wait for a concrete post-scope / approved plan.
          const clarifyOnly =
            nextSuspension?.kind === 'clarification_required';
          if (resultPlan && !clarifyOnly) {
            setPendingPlan(resultPlan);
            setPendingPlanStrategy(resultPlanStrategy ?? null);
            if (resultTaskList) setPendingTaskList(resultTaskList);
          } else if (resultTaskList) {
            setPendingTaskList(resultTaskList);
          }
          if (options?.formatPlanAnswer) {
            assistant = resolvePlanDisplayText({
              answer: assistant,
              ...(resultPlan ? { plan: resultPlan } : {}),
            });
          }
          paintAssistant({
            text: assistant,
            activity,
            streaming: false,
          });
          pushUsage({ ...usage, live: false });
        }
      }

      return {
        assistant,
        activity,
        suspension: nextSuspension,
        mutatedPaths: [...mutated],
        tokenUsage: { ...usage, live: false },
        ...(resultPlan ? { plan: resultPlan } : {}),
        ...(resultPlanStrategy ? { planStrategy: resultPlanStrategy } : {}),
        ...(resultTaskList ? { taskList: resultTaskList } : {}),
      };
    },
    [],
  );

  const resolveFileChanges = useCallback(
    async (paths: string[]): Promise<DesktopFileChanges | undefined> => {
      if (!engine || paths.length === 0) return undefined;
      try {
        return await fetchFileChanges({ ...engine, paths });
      } catch {
        return {
          files: paths.map((path) => ({
            path,
            status: 'M' as const,
            additions: 0,
            deletions: 0,
          })),
          totalAdditions: 0,
          totalDeletions: 0,
        };
      }
    },
    [engine],
  );

  return {
    consumeStream,
    resolveFileChanges,
  };
}
