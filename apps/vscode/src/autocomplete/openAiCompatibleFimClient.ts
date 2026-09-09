import {
  buildFimHeaders,
  buildFimRequestBody,
  buildFimUrl,
  extractFimChoiceText,
  mergeAbortSignals,
  sanitizeFimCompletion,
  type FimContextWindow,
  type FimHttpConfig,
} from './fim.js';

export interface FimCompletionRequest extends FimContextWindow {
  model: string;
  maxTokens: number;
  temperature: number;
  abortSignal?: AbortSignal;
  metadata?: Readonly<Record<string, string>>;
}

export interface FimCompletionResult {
  text: string;
}

export class OpenAiCompatibleFimClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: FimHttpConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async complete(request: FimCompletionRequest): Promise<FimCompletionResult> {
    const model = request.model.trim();
    const baseUrl = this.config.baseUrl.trim();
    if (!baseUrl || !model) return { text: '' };

    const merged = mergeAbortSignals(request.abortSignal, this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(buildFimUrl(this.config), {
        method: 'POST',
        headers: buildFimHeaders(this.config),
        body: JSON.stringify(
          buildFimRequestBody({
            prefix: request.prefix,
            suffix: request.suffix,
            model,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            metadata: request.metadata,
          }),
        ),
        signal: merged.signal,
      });
      if (!response.ok) return { text: '' };
      const data = (await response.json().catch(() => undefined)) as
        | Parameters<typeof extractFimChoiceText>[0]
        | undefined;
      if (!data) return { text: '' };
      return {
        text: sanitizeFimCompletion({
          completion: extractFimChoiceText(data),
          suffix: request.suffix,
        }),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { text: '' };
      }
      return { text: '' };
    } finally {
      merged.dispose();
    }
  }
}
