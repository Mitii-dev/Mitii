import type { ChatDelta } from './types';
import { ProviderError } from './errors';
import { debugTrace } from '../../kernel/telemetry/AsyncDebugTrace';

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<ChatDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let networkChunkSequence = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      networkChunkSequence += 1;
      debugTrace.trace('llm', 'network_chunk_receive', {
        sequence: networkChunkSequence,
        bytes: value.byteLength,
      });
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          continue;
        }
        if (!trimmed.startsWith('data: ')) {
          continue;
        }

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{
              delta?: {
                content?: string;
                reasoning?: string;
                reasoning_content?: string;
                redacted_reasoning?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            error?: { message?: string };
          };

          if (json.error?.message) {
            throw new ProviderError(json.error.message, 'parse');
          }

          const choice = json.choices?.[0];
          const delta = choice?.delta;

          const out: ChatDelta = {};
          if (delta?.content) {
            out.content = delta.content;
          }
          if (delta?.reasoning || delta?.reasoning_content || delta?.redacted_reasoning) {
            out.reasoning = delta.reasoning ?? delta.reasoning_content ?? delta.redacted_reasoning;
          }
          if (delta?.tool_calls) {
            out.tool_calls = delta.tool_calls;
          }
          if (choice?.finish_reason) {
            out.finish_reason = choice.finish_reason;
            out.done = true;
          }

          if (out.content || out.reasoning || out.tool_calls || out.done) {
            yield out;
          }
        } catch (e) {
          if (e instanceof ProviderError) {
            throw e;
          }
          debugTrace.trace('llm', 'malformed_sse_frame', {
            sequence: networkChunkSequence,
            error: e instanceof Error ? e.message : String(e),
          }, trimmed);
        }
      }
    }
    yield { done: true };
  } finally {
    reader.releaseLock();
  }
}
