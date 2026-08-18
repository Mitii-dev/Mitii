import {
  AnthropicLlmPort,
  EchoLlmPort,
  GeminiLlmPort,
  OpenAiCompatibleLlmPort,
  type LlmPort,
  type ModelCapabilities,
} from '@mitii/v8';

import {
  getProviderPreset,
  isHostProviderType,
  type HostProviderType,
} from './providerPresets.js';

export interface CreateHostLlmPortsInput {
  type?: string;
  preset?: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  capabilities?: Partial<
    Pick<
      ModelCapabilities,
      | 'contextWindowTokens'
      | 'maximumOutputTokens'
      | 'supportsTools'
      | 'supportsStructuredOutput'
      | 'supportsVision'
      | 'supportsReasoning'
      | 'supportsPromptCaching'
    >
  >;
  fetchImpl?: typeof fetch;
}

export interface HostLlmPorts {
  understandingLlm: LlmPort;
  runLlm: LlmPort;
  providerLabel: string;
  type: HostProviderType;
}

/**
 * Compose run + understanding LlmPorts from host settings.
 * Secrets stay on the adapter config; V8 is not consulted for keys.
 */
export function createHostLlmPorts(
  input: CreateHostLlmPortsInput,
): HostLlmPorts {
  const preset = getProviderPreset(input.preset ?? input.type ?? 'echo');
  const requested = input.type ?? preset?.type ?? 'echo';
  const type: HostProviderType = isHostProviderType(requested)
    ? requested
    : (preset?.type ?? 'echo');
  const model = input.model.trim() || preset?.model || 'echo';
  const baseUrl = input.baseUrl?.trim() || preset?.baseUrl || '';
  const capabilities = input.capabilities;
  const shared = {
    model,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };

  if (type === 'anthropic') {
    const runLlm = new AnthropicLlmPort({
      ...shared,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: {
        supportsTools: true,
        ...capabilities,
      },
    });
    const understandingLlm = new AnthropicLlmPort({
      ...shared,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: {
        supportsTools: true,
        supportsStructuredOutput: true,
        ...capabilities,
      },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `anthropic:${model}`,
      type,
    };
  }

  if (type === 'gemini') {
    const runLlm = new GeminiLlmPort({
      ...shared,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: {
        supportsTools: true,
        ...capabilities,
      },
    });
    const understandingLlm = new GeminiLlmPort({
      ...shared,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: {
        supportsTools: true,
        supportsStructuredOutput: true,
        ...capabilities,
      },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `gemini:${model}`,
      type,
    };
  }

  if (type === 'openai-compatible') {
    const openaiShared = {
      ...shared,
      ...(baseUrl ? { baseUrl } : {}),
      ...(preset?.authHeader ? { authHeader: preset.authHeader } : {}),
      ...(preset?.chatCompletionsPath
        ? { chatCompletionsPath: preset.chatCompletionsPath }
        : {}),
    };
    const runLlm = new OpenAiCompatibleLlmPort({
      ...openaiShared,
      capabilities: {
        supportsTools: true,
        supportsPromptCaching: true,
        ...capabilities,
      },
    });
    const understandingLlm = new OpenAiCompatibleLlmPort({
      ...openaiShared,
      capabilities: {
        supportsTools: true,
        supportsStructuredOutput: true,
        supportsPromptCaching: true,
        ...capabilities,
      },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `openai-compatible:${model}`,
      type,
    };
  }

  const echo = new EchoLlmPort({ modelId: model });
  return {
    understandingLlm: echo,
    runLlm: echo,
    providerLabel: 'echo',
    type: 'echo',
  };
}
