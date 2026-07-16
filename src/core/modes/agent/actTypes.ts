import type { AskScopeResolution, ProjectCatalog } from '../ask/askTypes';
import type { AgentDepth } from '../../config/schema';
import type { TaskAnalysis, TaskComplexity } from '../../runtime/TaskAnalyzer';

export type ActIntent =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'audit'
  | 'log_audit'
  | 'question'
  | 'diagnose';

export type ActExecutionPath =
  | 'resume_saved_plan'
  | 'orchestrated'
  | 'direct'
  | 'audit'
  | 'log_audit'
  | 'mdx_repair';

export interface ActRoute {
  intent: ActIntent;
  executionPath: ActExecutionPath;
  complexity: TaskComplexity;
  shouldUsePlanner: boolean;
  shouldUseSubagents: boolean;
  shouldVerify: boolean;
  summary: string;
}

export interface ActRunPlan {
  route: ActRoute;
  executionPath: ActExecutionPath;
  catalog?: ProjectCatalog;
  scope: AskScopeResolution;
  promptContext: string;
  maxSteps: number;
  autoContinue: boolean;
  maxAutoContinues: number;
  shouldVerify: boolean;
  verifyCommands: string[];
  suggestedSkills: string[];
  skillPlaybookContext: string;
  appliedSkills: string[];
  savedPlanId?: string;
  taskAnalysis: TaskAnalysis;
}

export type ActDepth = AgentDepth;
