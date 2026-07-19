import type { LlmProvider, ChatRequest, ChatDelta, ModelCapabilities, ChatMessage } from '../../kernel/llm/types';
import type { ToolDefinition } from '../../kernel/llm/toolTypes';
import { parseAnthropicSseStream } from '../../kernel/llm/anthropicSseParser';
import { normalizeProviderError, ProviderError } from '../../kernel/llm/errors';
import { estimateTokensAsync } from '../../kernel/llm/tokenEstimate';
import { debugTrace } from '../../kernel/telemetry/AsyncDebugTrace';

export interface AnthropicConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  capabilities?: Partial<ModelCapabilities>;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly capabilities: ModelCapabilities;

  constructor(private readonly config: AnthropicConfig) {
    this.capabilities = {
      contextWindow: config.capabilities?.contextWindow ?? 200_000,
      supportsStreaming: config.capabilities?.supportsStreaming ?? true,
      supportsTools: config.capabilities?.supportsTools ?? true,
      supportsEmbeddings: false,
      supportsVision: config.capabilities?.supportsVision ?? true,
      supportsReasoning: config.capabilities?.supportsReasoning ?? false,
    };
  }

  async *complete(request: ChatRequest): AsyncIterable<ChatDelta> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/v1/messages`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    const { system, messages } = splitAnthropicMessages(request.messages);
    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      max_tokens: request.maxTokens ?? 8192,
      messages,
      temperature: request.temperature ?? 0.2,
      stream: request.stream !== false,
    };
    if (system) body.system = system;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toAnthropicTool);
      body.tool_choice = request.toolChoice === 'required'
        ? { type: 'any' }
        : request.toolChoice === 'none'
          ? { type: 'none' }
          : { type: 'auto' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      debugTrace.trace('llm', 'transport_response', {
        provider: this.id,
        status: response.status,
        ok: response.ok,
        contentType: response.headers?.get?.('content-type'),
        contentLength: response.headers?.get?.('content-length'),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        if (response.status === 401) {
          throw new ProviderError('Authentication failed. Check your Anthropic API key.', 'auth', 401);
        }
        throw new ProviderError(
          `Anthropic returned ${response.status}: ${text.slice(0, 200)}`,
          'unknown',
          response.status
        );
      }

      if (request.stream === false) {
        const json = await response.json() as {
          content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
          stop_reason?: string;
        };
        for (const block of json.content ?? []) {
          if (block.type === 'text' && block.text) {
            yield { content: block.text };
          }
          if (block.type === 'tool_use' && block.id && block.name) {
            yield {
              tool_calls: [{
                index: 0,
                id: block.id,
                function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
              }],
            };
          }
        }
        yield { done: true, finish_reason: json.stop_reason };
        return;
      }

      if (!response.body) {
        throw new ProviderError('Empty response body from Anthropic', 'parse');
      }
      yield* parseAnthropicSseStream(response.body);
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async countTokens(text: string): Promise<number> {
    return estimateTokensAsync(text);
  }
}

function splitAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: Array<Record<string, unknown>>;
} {
  const systemParts = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content);
  const nonSystem = messages.filter((m) => m.role !== 'system');

  const out: Array<Record<string, unknown>> = [];
  for (const msg of nonSystem) {
    if (msg.role === 'tool') {
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        }],
      });
      continue;
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || '{}');
        } catch {
          input = {};
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      out.push({ role: 'assistant', content });
      continue;
    }
    if (msg.attachments?.length && (msg.role === 'user' || msg.role === 'assistant')) {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const attachment of msg.attachments) {
        if (attachment.kind !== 'image') continue;
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      out.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content,
      });
      continue;
    }
    out.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: out,
  };
}

function toAnthropicTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
  };
}
