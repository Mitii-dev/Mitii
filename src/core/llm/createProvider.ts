import type { ProviderConfig, ProviderType } from '../config/schema';
import type { LlmProvider } from './types';
import { EchoProvider } from './EchoProvider';
import { OpenAiCompatibleProvider } from './OpenAiCompatibleProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { getProviderPreset } from './providerPresets';

export interface ProviderResolveOptions {
  type?: ProviderType;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsEmbeddings?: boolean;
}

export function createProvider(
  config: ProviderConfig | ProviderResolveOptions,
  apiKey?: string
): LlmProvider {
  const type = config.type ?? 'echo';
  const preset = getProviderPreset(type);
  const baseUrl = ('baseUrl' in config && config.baseUrl) || preset?.baseUrl || 'http://localhost:11434/v1';
  const model = ('model' in config && config.model) || preset?.model || 'qwen3-coder:30b';
  const key = apiKey;
  const capabilities = {
    contextWindow: config.contextWindow ?? preset?.contextWindow ?? 8192,
    supportsStreaming: config.supportsStreaming ?? true,
    supportsTools: config.supportsTools ?? true,
    supportsEmbeddings: config.supportsEmbeddings ?? false,
  };

  switch (type) {
    case 'anthropic':
      return new AnthropicProvider({ baseUrl, model, apiKey: key, capabilities });
    case 'gemini':
      return new GeminiProvider({ baseUrl, model, apiKey: key, capabilities });
    case 'openai':
    case 'deepseek':
    case 'cursor':
    case 'codex':
    case 'openai-compatible':
      return new OpenAiCompatibleProvider({ baseUrl, model, apiKey: key, capabilities });
    case 'echo':
    default:
      return new EchoProvider();
  }
}
