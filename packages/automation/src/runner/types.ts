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
  /** Spec metadata_json (delivery, desktopFlow steps, …). Hosts may use it. */
  metadataJson?: string | null;
}

export interface AutomationStepResult {
  id: string;
  kind: string;
  status: 'done' | 'failed' | 'skipped';
  summary?: string;
  error?: string;
  durationMs?: number;
}

export interface AutomationExecuteResult {
  status: 'done' | 'failed' | 'cancelled';
  error?: string;
  answer?: string;
  sessionId?: string;
  reportMarkdown?: string;
  /** Deterministic pre-steps executed by the host (desktop enterprise). */
  stepResults?: AutomationStepResult[];
}

/**
 * Host-injected port. Implemented by @mitii/host using @mitii/sdk.
 * @mitii/automation never imports SDK.
 */
export interface AutomationRunExecutor {
  execute(input: AutomationExecuteInput): Promise<AutomationExecuteResult>;
}
