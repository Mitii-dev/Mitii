import {
  buildFimHeaders,
  buildFimUrl,
  extractFimChoiceText,
  mergeAbortSignals,
  sanitizeFimCompletion,
  type FimContextWindow,
  type FimHttpConfig,
} from './fim.js';

export interface NextEditRequestInput extends FimContextWindow {
  model: string;
  maxTokens: number;
  temperature: number;
  languageId?: string;
  relativePath?: string;
}

/**
 * Next-edit mode: ask the model for a short continuation that replaces or
 * extends the span after the cursor (chat-completions style prompt), then
 * sanitize like FIM.
 */
export function buildNextEditRequestBody(
  input: NextEditRequestInput,
): Record<string, unknown> {
  const pathHint = input.relativePath ? ` file=${input.relativePath}` : '';
  const langHint = input.languageId ? ` language=${input.languageId}` : '';
  const system =
    'You predict the next code edit at the cursor. Return only the code to insert; no markdown fences; no explanations.';
  const user = [
    `Predict the next edit.${pathHint}${langHint}`,
    '<<<PREFIX>>>',
    input.prefix.slice(-4_000),
    '<<<CURSOR>>>',
    '<<<SUFFIX>>>',
    input.suffix.slice(0, 1_500),
  ].join('\n');

  return {
    model: input.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    stream: false,
  };
}

export class OpenAiCompatibleNextEditClient {
  constructor(private readonly config: FimHttpConfig) {}

  async complete(
    input: NextEditRequestInput & { abortSignal?: AbortSignal },
  ): Promise<{ text: string }> {
    const url = buildFimUrl({
      baseUrl: this.config.baseUrl,
      endpointPath: this.config.endpointPath || 'chat/completions',
    });
    const { signal, dispose } = mergeAbortSignals(
      input.abortSignal,
      this.config.timeoutMs,
    );
    try {
      const fetchImpl = this.config.fetchImpl ?? fetch;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: buildFimHeaders(this.config),
        body: JSON.stringify(buildNextEditRequestBody(input)),
        signal,
      });
      if (!response.ok) {
        throw new Error(`next-edit HTTP ${response.status}`);
      }
      const json = (await response.json()) as {
        choices?: Array<{
          text?: string | null;
          message?: { content?: string | null };
        }>;
      };
      const raw = extractFimChoiceText(json);
      return {
        text: sanitizeFimCompletion({
          completion: raw,
          suffix: input.suffix,
          prefix: input.prefix,
        }),
      };
    } finally {
      dispose();
    }
  }
}
