import type { ChatDelta } from './types';
import { ProviderError } from './errors';

export async function* parseAnthropicSseStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<ChatDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            type?: string;
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              name?: string;
              id?: string;
            };
            index?: number;
            content_block?: { type?: string; id?: string; name?: string };
            message?: { stop_reason?: string };
            error?: { message?: string };
          };

          if (json.error?.message) {
            throw new ProviderError(json.error.message, 'parse');
          }

          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
            yield { content: json.delta.text };
          }

          if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
            const index = json.index ?? 0;
            toolCallBuffers.set(index, {
              id: json.content_block.id ?? `tool_${index}`,
              name: json.content_block.name ?? '',
              arguments: '',
            });
          }

          if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
            const index = json.index ?? 0;
            const existing = toolCallBuffers.get(index);
            if (existing && json.delta.partial_json) {
              existing.arguments += json.delta.partial_json;
              yield {
                tool_calls: [{
                  index,
                  id: existing.id,
                  function: { name: existing.name, arguments: existing.arguments },
                }],
              };
            }
          }

          if (json.type === 'message_stop' || json.message?.stop_reason) {
            yield { done: true, finish_reason: json.message?.stop_reason ?? 'stop' };
          }
        } catch (e) {
          if (e instanceof ProviderError) throw e;
        }
      }
    }
    yield { done: true };
  } finally {
    reader.releaseLock();
  }
}
