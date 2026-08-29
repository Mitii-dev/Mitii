export interface LocalModelPreset {
  model: string;
  label: string;
  contextWindow?: number;
}

/**
 * Optional context-window hints for known local model ids.
 * Not used to populate the model dropdown — that comes from Test connection.
 */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  { model: 'qwen3-coder:30b', label: 'Qwen3 Coder 30B', contextWindow: 262_144 },
  { model: 'qwen3.5:latest', label: 'Qwen3.5 latest', contextWindow: 256_000 },
  { model: 'qwen3.5:9b', label: 'Qwen3.5 9B', contextWindow: 256_000 },
  { model: 'qwen3.5:4b', label: 'Qwen3.5 4B', contextWindow: 256_000 },
  { model: 'devstral-small-2:24b', label: 'Devstral Small 2 24B', contextWindow: 128_000 },
  { model: 'codestral:22b', label: 'Codestral 22B', contextWindow: 32_768 },
  { model: 'deepseek-coder:33b-instruct-q4_0', label: 'DeepSeek Coder 33B Instruct Q4', contextWindow: 16_384 },
  { model: 'gemma4:latest', label: 'Gemma4 latest', contextWindow: 128_000 },
  { model: 'gemma4:12b', label: 'Gemma4 12B', contextWindow: 256_000 },
  { model: 'llama3.2:latest', label: 'Llama 3.2', contextWindow: 128_000 },
  { model: 'mistral:latest', label: 'Mistral', contextWindow: 32_768 },
];

export function findLocalModelPreset(model: string): LocalModelPreset | undefined {
  return LOCAL_MODEL_PRESETS.find((preset) => preset.model === model.trim());
}
