export interface LocalModelPreset {
  model: string;
  label: string;
  contextWindow?: number;
}

export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  { model: 'devstral-small-2:24b', label: 'Devstral Small 2 24B' },
  { model: 'codestral:22b', label: 'Codestral 22B' },
  { model: 'deepseek-coder:33b-instruct-q4_0', label: 'DeepSeek Coder 33B Instruct Q4_0' },
  { model: 'qwen3-coder:30b', label: 'Qwen3 Coder 30B' },
  { model: 'qwen3.6:27b', label: 'Qwen3.6 27B' },
  { model: 'qwen3.5:latest', label: 'Qwen3.5 latest - 6.6GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:0.8b', label: 'Qwen3.5 0.8B - 1.0GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:2b', label: 'Qwen3.5 2B - 2.7GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:4b', label: 'Qwen3.5 4B - 3.4GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'qwen3.5:9b', label: 'Qwen3.5 9B - 6.6GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'gemma4:latest', label: 'Gemma4 latest - 9.6GB - 128K - Text/Image', contextWindow: 128_000 },
  { model: 'gemma4:e2b', label: 'Gemma4 E2B - 7.2GB - 128K - Text/Image', contextWindow: 128_000 },
  { model: 'gemma4:e4b', label: 'Gemma4 E4B - 9.6GB - 128K - Text/Image', contextWindow: 128_000 },
  { model: 'gemma4:12b', label: 'Gemma4 12B - 7.6GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'gemma4:26b', label: 'Gemma4 26B - 18GB - 256K - Text/Image', contextWindow: 256_000 },
  { model: 'gemma4:31b', label: 'Gemma4 31B - 20GB - 256K - Text/Image', contextWindow: 256_000 },
];

export function findLocalModelPreset(model: string): LocalModelPreset | undefined {
  return LOCAL_MODEL_PRESETS.find((preset) => preset.model === model.trim());
}

export function resolveLocalModelPresetContextWindow(model: string): number | undefined {
  return findLocalModelPreset(model)?.contextWindow;
}
