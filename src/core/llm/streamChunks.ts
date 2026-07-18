import type { AssistantStreamChunk } from './types';

export function chunkContent(chunk: AssistantStreamChunk): string {
  return typeof chunk === 'string' ? chunk : (chunk.content ?? '');
}

export function chunkReasoning(chunk: AssistantStreamChunk): string {
  return typeof chunk === 'string' ? '' : (chunk.reasoning ?? '');
}

/** True for intermediate step narration that must not be concatenated into the final answer. */
export function isProgressChunk(chunk: AssistantStreamChunk): boolean {
  return typeof chunk !== 'string' && chunk.kind === 'progress';
}

export function toAssistantStreamChunk(
  content?: string,
  reasoning?: string,
  kind?: 'progress' | 'final'
): AssistantStreamChunk | undefined {
  if (kind === 'progress') {
    if (!content && !reasoning) return undefined;
    return { content, reasoning, kind: 'progress' };
  }
  if (reasoning) return { content, reasoning, kind };
  if (content) return kind === 'final' ? { content, kind: 'final' } : content;
  return undefined;
}
