import type { ToolDefinition } from './toolTypes';
import type { AgenticTier, ReasoningEffort } from '../../kernel/policy/tierPolicy';
export type { AgenticTier } from '../../kernel/policy/tierPolicy';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: ChatImageAttachment[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ChatImageAttachment {
  kind: 'image';
  mimeType: string;
  data: string;
  name?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  reasoningEffort?: ReasoningEffort;
  includeReasoning?: boolean;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatDelta {
  content?: string;
  reasoning?: string;
  done?: boolean;
  error?: string;
  tool_calls?: ToolCallDelta[];
  finish_reason?: string;
}

export interface AssistantStreamDelta {
  content?: string;
  reasoning?: string;
  /** Progress narration between tool calls — UI only, not persisted as the final answer. */
  kind?: 'progress' | 'final';
}

export type AssistantStreamChunk = string | AssistantStreamDelta;

export interface ModelCapabilities {
  contextWindow: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  agenticTier?: AgenticTier;
}

export interface LlmProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  complete(request: ChatRequest): AsyncIterable<ChatDelta>;
  countTokens?(text: string): Promise<number>;
}
