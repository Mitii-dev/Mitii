import type { JsonSchema } from '../shared/json';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatRequest {
  messages: readonly ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatDelta {
  content?: string;
  reasoning?: string;
  done?: boolean;
  error?: string;
}

export interface ModelCapabilities {
  contextWindow: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
}

export interface LlmProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  complete(request: ChatRequest): AsyncIterable<ChatDelta>;
  countTokens?(text: string): Promise<number>;
}

export interface ProviderFactoryContext {
  apiKey?: string;
  settings: Record<string, unknown>;
}

export interface LlmProviderContribution {
  id: string;
  owner: string;
  displayName: string;
  settingsSchema: JsonSchema;
  capabilities: Partial<ModelCapabilities>;
  create(context: ProviderFactoryContext): LlmProvider;
}
