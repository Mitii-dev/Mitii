import type { ProviderType } from '../../kernel/config/schema';
import { getProviderPreset } from './providerPresets';

/** Map informal / UI model labels to provider-valid API model ids. */
const MODEL_ALIASES: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek-chat',
  'deepseek-v4': 'deepseek-chat',
  'deepseek-v3': 'deepseek-chat',
  'deepseek-r1': 'deepseek-reasoner',
  'deepseek-reasoner': 'deepseek-reasoner',
  'deepseek-coder': 'deepseek-coder',
};

/** Local Ollama-style ids that must not be sent to cloud APIs. */
const LOCAL_MODEL_PATTERN = /[:/]|^codestral|^qwen|^llama|^mistral|^devstral|^gemma/i;

export interface ResolvedModel {
  model: string;
  warning?: string;
}

export function normalizeProviderModel(
  providerType: ProviderType,
  model: string | undefined
): ResolvedModel {
  const preset = getProviderPreset(providerType);
  const raw = model?.trim() || preset?.model || 'qwen3-coder:30b';
  const alias = MODEL_ALIASES[raw.toLowerCase()];
  if (alias) {
    return { model: alias };
  }

  if (providerType === 'deepseek') {
    if (LOCAL_MODEL_PATTERN.test(raw)) {
      const fallback = preset?.model ?? 'deepseek-chat';
      return {
        model: fallback,
        warning: `Model "${raw}" is a local/Ollama id and cannot be used with DeepSeek API — using "${fallback}" instead. Set provider type to OpenAI-compatible for local models.`,
      };
    }
    if (!/^deepseek-/i.test(raw)) {
      const fallback = preset?.model ?? 'deepseek-chat';
      return {
        model: fallback,
        warning: `Model "${raw}" is not a DeepSeek API model — using "${fallback}".`,
      };
    }
  }

  if (
    (providerType === 'openai' || providerType === 'anthropic' || providerType === 'gemini') &&
    LOCAL_MODEL_PATTERN.test(raw)
  ) {
    const fallback = preset?.model ?? raw;
    return {
      model: fallback,
      warning: `Model "${raw}" looks like a local model id for cloud provider "${providerType}".`,
    };
  }

  return { model: raw };
}

export function modelLikelySupportsTools(providerType: ProviderType, model: string): boolean {
  if (providerType === 'echo') return false;
  const normalized = normalizeProviderModel(providerType, model).model.toLowerCase();
  if (/^deepseek-reasoner$/i.test(normalized)) return false;
  if (LOCAL_MODEL_PATTERN.test(model) && providerType === 'openai-compatible') {
    // Ollama models vary — caller should probe; assume true for openai-compatible local.
    return true;
  }
  return true;
}
