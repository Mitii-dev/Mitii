import type { MemoryPipeline } from '@mitii/v8';

import {
  observeWorkspaceEvent,
  type ObserveWorkspaceEventResult,
} from './memoryCapture.js';

const CAPTURE_TOOL_NAMES = new Set([
  'apply_patch',
  'delete_file',
  'delete_directory',
  'move_file',
  'run_command',
]);

export interface MemoryCaptureContext {
  workspaceRoot: string;
  workspaceId: string;
  pipeline: MemoryPipeline;
}

export interface ObservingRunEvent {
  type: string;
  toolName?: string;
  status?: string;
  summary?: string;
  outputPreview?: string;
  reasonCode?: string;
}

export function shouldObserveRunEvent(event: ObservingRunEvent): boolean {
  if (event.type !== 'tool_completed') {
    return false;
  }
  const name = event.toolName ?? '';
  if (CAPTURE_TOOL_NAMES.has(name) || name.includes('verif')) {
    return true;
  }
  return event.status === 'failed';
}

/**
 * Host-owned capture hook for Agent run events.
 * Never throws — a failed observe must not break the run.
 */
export async function observeRunToolEvent(input: {
  event: ObservingRunEvent;
  capture: MemoryCaptureContext;
  userPrompt?: string;
}): Promise<ObserveWorkspaceEventResult | undefined> {
  if (!shouldObserveRunEvent(input.event)) {
    return undefined;
  }
  try {
    return await observeWorkspaceEvent({
      workspaceRoot: input.capture.workspaceRoot,
      workspaceId: input.capture.workspaceId,
      pipeline: input.capture.pipeline,
      toolName: input.event.toolName,
      hookType:
        input.event.status === 'failed' ? 'post_tool_failure' : 'post_tool',
      userPrompt: input.userPrompt,
      toolInput: input.event.summary,
      toolOutput: input.event.outputPreview ?? input.event.reasonCode,
    });
  } catch {
    return undefined;
  }
}
