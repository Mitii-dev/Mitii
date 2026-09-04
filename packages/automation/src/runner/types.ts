import type {
  AutomationAgentMode,
  AutomationAutonomyPreset,
} from '../types.js';

export interface AutomationExecuteInput {
  runId: string;
  specId: string;
  title: string;
  prompt: string;
  workspaceRoot: string;
  mode: AutomationAgentMode;
  autonomyPreset: AutomationAutonomyPreset;
  timeoutSeconds?: number;
}

export interface AutomationExecuteResult {
  status: 'done' | 'failed' | 'cancelled';
  error?: string;
  answer?: string;
  sessionId?: string;
  reportMarkdown?: string;
}

/**
 * Host-injected port. Implemented by @mitii/host using @mitii/sdk.
 * @mitii/automation never imports SDK.
 */
export interface AutomationRunExecutor {
  execute(input: AutomationExecuteInput): Promise<AutomationExecuteResult>;
}
