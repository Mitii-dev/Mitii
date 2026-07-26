import {
  EchoLlmPort,
  OpenAiCompatibleLlmPort,
} from '@mitii/sdk';
import type { LlmPort, ModelCapabilities, ModelEvent, ModelRequest } from '@mitii/v8';

/**
 * Deterministic understanding port for local smoke when no provider key is set.
 * Always classifies as a confident question so Decision Policy can route
 * direct_answer without calling a remote model.
 */
export class LocalUnderstandingLlmPort implements LlmPort {
  readonly id = 'cli-local-understanding';
  readonly capabilities: ModelCapabilities = {
    modelId: 'cli/local-understanding',
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
  };

  async *complete(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield {
      type: 'content_delta',
      content: JSON.stringify({
        interactionIntent: 'question',
        primaryTaskIntent: 'question',
        secondaryTaskIntents: [],
        confidence: 0.95,
        alternatives: [],
        needsClarification: false,
        reason: 'CLI local understanding (no remote provider).',
      }),
    };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

export interface ResolveCliPortsOptions {
  forceEcho?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedCliPorts {
  understandingLlm: LlmPort;
  runLlm: LlmPort;
  providerLabel: string;
}

export function resolveCliPorts(
  options: ResolveCliPortsOptions = {},
): ResolvedCliPorts {
  const env = options.env ?? process.env;
  const apiKey = env.MITII_API_KEY ?? env.OPENAI_API_KEY;
  const forceEcho = options.forceEcho === true || env.MITII_FORCE_ECHO === '1';

  if (!forceEcho && apiKey) {
    const model = env.MITII_MODEL ?? 'gpt-4o-mini';
    const baseUrl = env.MITII_BASE_URL;
    const runLlm = new OpenAiCompatibleLlmPort({
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
    const understandingLlm = new OpenAiCompatibleLlmPort({
      model,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      capabilities: { supportsStructuredOutput: true },
    });
    return {
      understandingLlm,
      runLlm,
      providerLabel: `openai-compatible:${model}`,
    };
  }

  return {
    understandingLlm: new LocalUnderstandingLlmPort(),
    runLlm: new EchoLlmPort(),
    providerLabel: 'echo',
  };
}
