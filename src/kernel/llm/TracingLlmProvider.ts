import { randomUUID } from 'crypto';
import { debugTrace } from '../../kernel/telemetry/AsyncDebugTrace';
import type { ChatDelta, ChatRequest, LlmProvider, ModelCapabilities } from './types';

export class TracingLlmProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  readonly countTokens?: (text: string) => Promise<number>;

  constructor(private readonly provider: LlmProvider) {
    this.id = provider.id;
    this.capabilities = provider.capabilities;
    this.countTokens = provider.countTokens
      ? (text: string) => provider.countTokens!(text)
      : undefined;
  }

  async *complete(request: ChatRequest): AsyncIterable<ChatDelta> {
    if (!debugTrace.isEnabled('llm')) {
      yield* this.provider.complete(request);
      return;
    }

    const callId = randomUUID();
    const startedAt = Date.now();
    let firstDeltaAt = 0;
    let chunks = 0;
    let contentChars = 0;
    let reasoningChars = 0;
    let toolCallFragments = 0;
    let finishReason: string | undefined;

    debugTrace.trace('llm', 'request_send', {
      callId,
      provider: this.id,
      model: request.model,
      streaming: request.stream !== false,
      messageCount: request.messages.length,
      messageChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
      toolCount: request.tools?.length ?? 0,
      toolChoice: request.toolChoice,
      reasoningEffort: request.reasoningEffort,
    }, request);

    try {
      for await (const delta of this.provider.complete(request)) {
        const now = Date.now();
        if (!firstDeltaAt) {
          firstDeltaAt = now;
          debugTrace.trace('llm', 'response_start', {
            callId,
            provider: this.id,
            timeToFirstDeltaMs: now - startedAt,
          });
        }
        chunks += 1;
        contentChars += delta.content?.length ?? 0;
        reasoningChars += delta.reasoning?.length ?? 0;
        toolCallFragments += delta.tool_calls?.length ?? 0;
        finishReason = delta.finish_reason ?? finishReason;
        debugTrace.trace('llm', 'response_delta', {
          callId,
          sequence: chunks,
          contentChars: delta.content?.length ?? 0,
          reasoningChars: delta.reasoning?.length ?? 0,
          toolCallFragments: delta.tool_calls?.length ?? 0,
          done: Boolean(delta.done),
          finishReason: delta.finish_reason,
        }, delta);
        yield delta;
      }

      debugTrace.trace('llm', 'response_end', {
        callId,
        provider: this.id,
        durationMs: Date.now() - startedAt,
        timeToFirstDeltaMs: firstDeltaAt ? firstDeltaAt - startedAt : undefined,
        chunks,
        contentChars,
        reasoningChars,
        toolCallFragments,
        finishReason,
      });
    } catch (error) {
      debugTrace.trace('llm', 'request_error', {
        callId,
        provider: this.id,
        durationMs: Date.now() - startedAt,
        chunks,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

}

export function withLlmTracing(provider: LlmProvider): LlmProvider {
  return provider instanceof TracingLlmProvider ? provider : new TracingLlmProvider(provider);
}
