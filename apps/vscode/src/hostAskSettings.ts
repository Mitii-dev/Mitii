import type { AgentRunBudget, MitiiResumeInput } from '@mitii/sdk';
import type * as vscode from 'vscode';

import { resolveApprovalPolicy } from './approvalPolicy.js';

/** Re-apply the current `mitii.safety.approvalMode` to a resume input. */
export function withCurrentApprovalPolicy(
  vs: typeof vscode,
  resume: MitiiResumeInput,
): MitiiResumeInput {
  const preset =
    vs.workspace.getConfiguration('mitii').get<string>('safety.approvalMode') ??
    'guided';
  return {
    ...resume,
    approvalMode: resolveApprovalPolicy(preset).approvalMode,
  };
}

/** Read `mitii.runBudget.*` settings into an engine run budget. */
export function resolveRunBudget(vs: typeof vscode): AgentRunBudget {
  const cfg = vs.workspace.getConfiguration('mitii');
  if (cfg.get<boolean>('runBudget.unlimited') ?? false) {
    return {
      unlimited: true,
      maxModelCalls: 1_000_000,
      maxToolCalls: 1_000_000,
      maxLoopIterations: 1_000_000,
      maxWallTimeMs: 365 * 24 * 60 * 60 * 1000,
    };
  }
  const readPositive = (key: string, fallback: number): number => {
    const value = cfg.get<number>(key);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    return fallback;
  };
  return {
    maxModelCalls: readPositive('runBudget.maxModelCalls', 64),
    maxToolCalls: readPositive('runBudget.maxToolCalls', 128),
    maxLoopIterations: readPositive('runBudget.maxLoopIterations', 96),
    maxWallTimeMs:
      readPositive('runBudget.maxWallTimeMinutes', 30) * 60 * 1000,
  };
}

/** Developer-facing run-log detail level; see `mitii.logVerbosity` in package.json. */
export function resolveLogVerbosity(
  vs: typeof vscode,
): 'minimal' | 'standard' | 'verbose' {
  const value = vs.workspace
    .getConfiguration('mitii')
    .get<string>('logVerbosity');
  return value === 'minimal' || value === 'standard' || value === 'verbose'
    ? value
    : 'verbose';
}
