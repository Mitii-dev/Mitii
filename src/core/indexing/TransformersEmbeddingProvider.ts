import { createLogger } from '../telemetry/Logger';
import type { EmbeddingProvider } from './EmbeddingProvider';

const log = createLogger('TransformersEmbedding');

type FeatureExtractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

let pipelinePromise: Promise<FeatureExtractor | null> | null = null;

async function loadPipeline(): Promise<FeatureExtractor | null> {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    try {
      // Optional dependency — dynamic import keeps extension load fast when not installed.
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      return extractor as FeatureExtractor;
    } catch (error) {
      log.warn('MiniLM embeddings unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();

  return pipelinePromise;
}

/** Local MiniLM embeddings via @xenova/transformers (Continue pattern). */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'minilm';

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await loadPipeline();
    if (!extractor) {
      return texts.map(() => []);
    }

    const outputs: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i].slice(0, 2000);
      try {
        const output = await extractor([text], { pooling: 'mean', normalize: true });
        const vectors = output.tolist();
        outputs.push(vectors[0] ?? []);
        // Yield to event loop so the extension host stays responsive.
        await new Promise((resolve) => setTimeout(resolve, 5));
      } catch (error) {
        log.warn('MiniLM embed failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        outputs.push([]);
      }
    }
    return outputs;
  }
}

export function isTransformersEmbeddingAvailable(): boolean {
  try {
    require.resolve('@xenova/transformers');
    return true;
  } catch {
    return false;
  }
}
