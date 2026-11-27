/** Chat message and history thread shapes. */

import { type DesktopActivityItem } from '../../shared/activity.js';
import { type DesktopFileChanges } from '../../shared/fileChanges.js';
import { type TokenUsageState } from '@mitii/ui-react';
import {
  type PlanArtifact,
  type PlanStrategyDecision,
  type TaskList,
} from '../../shared/planFormat.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: string;
  activity?: DesktopActivityItem[];
  fileChanges?: DesktopFileChanges;
  streaming?: boolean;
}

export interface HistoryThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
  tokenUsage?: TokenUsageState;
  pendingPlan?: PlanArtifact;
  pendingPlanStrategy?: PlanStrategyDecision;
  pendingTaskList?: TaskList;
  /** Durable notebook of finished plan step ids across desk refills. */
  completedPlanStepIds?: string[];
  /** Last structured next-action prompt from a partial slice. */
  pendingNextActionPrompt?: string;
}
