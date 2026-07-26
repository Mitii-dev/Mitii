import type { LlmProvider, ChatRequest, ChatDelta, ModelCapabilities, ChatMessage } from '../../kernel/llm/types';
import type { ToolDefinition } from '../../kernel/llm/toolTypes';
import { normalizeProviderError, ProviderError } from '../../kernel/llm/errors';
import { estimateTokensAsync } from '../../kernel/llm/tokenEstimate';
import { debugTrace } from '../../kernel/telemetry/AsyncDebugTrace';

export interface GeminiConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  capabilities?: Partial<ModelCapabilities>;
}

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  readonly capabilities: ModelCapabilities;

  constructor(private readonly config: GeminiConfig) {
    this.capabilities = {
      contextWindow: config.capabilities?.contextWindow ?? 1_000_000,
      supportsStreaming: config.capabilities?.supportsStreaming ?? true,
      supportsTools: config.capabilities?.supportsTools ?? true,
      supportsEmbeddings: false,
      supportsVision: config.capabilities?.supportsVision ?? true,
      supportsReasoning: config.capabilities?.supportsReasoning ?? false,
    };
  }

  async *complete(request: ChatRequest): AsyncIterable<ChatDelta> {
    const model = request.model ?? this.config.model;
    const root = this.config.baseUrl.replace(/\/$/, '');
    const stream = request.stream !== false;
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const url = new URL(`${root}/v1beta/models/${model}:${action}`);
    if (this.config.apiKey) {
      url.searchParams.set('key', this.config.apiKey);
    }

    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxTokens ?? 8192,
      },
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = [{ functionDeclarations: request.tools.map(toGeminiTool) }];
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        if (response.status === 401 || response.status === 403) {
          throw new ProviderError('Authentication failed. Check your Gemini API key.', 'auth', response.status);
        }
        throw new ProviderError(
          `Gemini returned ${response.status}: ${text.slice(0, 200)}`,
          'unknown',
          response.status
        );
      }

      if (!stream) {
        const json = await response.json() as GeminiResponse;
        yield* emitGeminiResponse(json);
        return;
      }

      if (!response.body) {
        throw new ProviderError('Empty response body from Gemini', 'parse');
      }
      yield* parseGeminiStream(response.body);
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async countTokens(text: string): Promise<number> {
    return estimateTokensAsync(text);
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }>;
    };
    finishReason?: string;
  }>;
};

function* emitGeminiResponse(json: GeminiResponse): Generator<ChatDelta> {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  for (const [index, part] of parts.entries()) {
    if (part.text) yield { content: part.text };
    if (part.functionCall?.name) {
      yield {
        tool_calls: [{
          index,
          id: `gemini_${part.functionCall.name}_${index}`,
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          },
        }],
      };
    }
  }
  yield { done: true, finish_reason: json.candidates?.[0]?.finishReason };
}

async function* parseGeminiStream(body: ReadableStream<Uint8Array>): AsyncIterable<ChatDelta> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split(/\n(?=\{)/);
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const trimmed = chunk.trim().replace(/^,/, '');
        if (!trimmed.startsWith('{')) continue;
        try {
          const json = JSON.parse(trimmed) as GeminiResponse;
          yield* emitGeminiResponse(json);
        } catch {
          // skip malformed chunk
        }
      }
    }
    yield { done: true };
  } finally {
    reader.releaseLock();
  }
}

function toGeminiContents(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      out.push({ role: 'user', parts: [{ text: `[System]\n${msg.content}` }] });
      continue;
    }
    if (msg.role === 'tool') {
      out.push({
        role: 'function',
        parts: [{ functionResponse: { name: msg.name ?? 'tool', response: { result: msg.content } } }],
      });
      continue;
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
      out.push({ role: 'model', parts });
      continue;
    }
    if (msg.attachments?.length && (msg.role === 'user' || msg.role === 'assistant')) {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.content) parts.push({ text: msg.content });
      for (const attachment of msg.attachments) {
        if (attachment.kind !== 'image') continue;
        parts.push({
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      out.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      });
      continue;
    }
    out.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }
  return out;
}

function toGeminiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ?? { type: 'object', properties: {} },
  };
}
